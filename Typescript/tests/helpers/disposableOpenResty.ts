// disposableOpenResty.ts -- a throwaway OpenResty IN FRONT of a backend, built from the generator's own configuration.
//
//   main conf     buildNginxConfigContent()   (the router, the default server, the catch-all)
//   app conf      getNetgetAppConfContent()   (the admin block for `localhost`/`127.0.0.1` that proxies to the backend,
//                                              the monad / surface blocks)  -- or the text of an INSTALLED conf.d file
//
// Only what has to differ to run unprivileged and away from the machine is rewritten: the listen ports (loopback, high),
// the backend port (the generated blocks say 127.0.0.1:3000), the certificate, the `user` directive and, optionally, the
// root of the front end and the Lua tree. Everything else is what the release writes.
//
// Safety: it refuses to start if the rendered configuration still names a log, a pid or a conf.d of the real machine
// (/opt/homebrew/var/log, /opt/homebrew/etc/openresty/conf.d), because nginx would write there. The real conf.d is never
// included: this one's own is under `dir`.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface DisposableOpenResty {
  dir: string;
  httpPort: number;
  httpsPort: number;
  origin: string;            // http://127.0.0.1:<httpPort>
  mainConf: string;
  appConf: string;
  errorLogPath: string;
  /** every error log this instance writes (the main one and the app blocks') */
  errorLogPaths: string[];
  stop(): Promise<void>;
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

export function findOpenResty(): string | undefined {
  return ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
}

export async function startDisposableOpenResty(options: {
  backendPort: number;
  /** Text of a conf.d/netget_app.conf to put in front instead of the generated one (an installed file). */
  appConfText?: string;
  /** The directory nginx serves the front end from (replaces every `.../main-server-ui/dist` root). */
  uiRoot?: string;
  /** A Lua tree to search first (the release's); without it the installed tree is used, as on the machine. */
  luaRoot?: string;
  /** This machine's own LAN address: every server block also listens there, to test what a non-loopback peer gets. */
  lanIp?: string;
}): Promise<DisposableOpenResty> {
  const openresty = findOpenResty();
  if (!openresty) throw new Error('no openresty on this machine');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-openresty-'));
  const confDDir = path.join(dir, 'conf.d');
  const logDir = path.join(dir, 'logs');
  fs.mkdirSync(confDDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const { detectOpenRestyLayout } = await import('../../src/modules/NetGetX/OpenResty/platformDetect.ts');
  const { buildNginxConfigContent } = await import('../../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
  const { getNetgetAppConfContent } = await import('../../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

  const httpPort = await freePort();
  const httpsPort = await freePort();
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });

  const layout = { ...detectOpenRestyLayout(), confDDir, logDir, configFilePath: path.join(dir, 'nginx.conf') };
  let mainConf = buildNginxConfigContent(layout as any)
    .replace('listen 80 default_server;', `listen 127.0.0.1:${httpPort} default_server;`).replace(/\n\s*listen \[::\]:80 default_server;/, '')
    .replace('listen 443 ssl default_server;', `listen 127.0.0.1:${httpsPort} ssl default_server;`).replace(/\n\s*listen \[::\]:443 ssl default_server;/, '')
    .replace(/ssl_certificate\s+[^;]+;/, `ssl_certificate ${cert};`).replace(/ssl_certificate_key\s+[^;]+;/, `ssl_certificate_key ${key};`)
    .replace(/^\s*user\s+[^;]+;\s*$/m, '');
  if (options.luaRoot) mainConf = mainConf.replace(/lua_package_path "/, `lua_package_path "${options.luaRoot}/?.lua;`);

  let appConf = options.appConfText ?? getNetgetAppConfContent();
  appConf = appConf
    .replaceAll('/opt/homebrew/var/log/nginx', logDir)
    .replaceAll('127.0.0.1:3000', `127.0.0.1:${options.backendPort}`)
    .replace(/^(\s*)listen 80;\s*$/gm, `$1listen 127.0.0.1:${httpPort};`).replace(/^\s*listen \[::\]:80;\s*\n/gm, '')
    .replace(/^(\s*)listen 443 ssl;\s*$/gm, `$1listen 127.0.0.1:${httpsPort} ssl;`).replace(/^\s*listen \[::\]:443 ssl;\s*\n/gm, '')
    .replace(/ssl_certificate\s+[^;]+;/g, `ssl_certificate ${cert};`).replace(/ssl_certificate_key\s+[^;]+;/g, `ssl_certificate_key ${key};`);
  if (options.lanIp) {
    const mine = Object.values(os.networkInterfaces()).flat().some((i) => i && i.address === options.lanIp);
    if (!mine) throw new Error(`REFUSING TO START: ${options.lanIp} is not an address of this machine`);
    appConf = appConf.replace(new RegExp(`^(\\s*)listen 127\\.0\\.0\\.1:${httpPort};\\s*$`, 'gm'), `$1listen 127.0.0.1:${httpPort};\n$1listen ${options.lanIp}:${httpPort};`);
  }
  if (options.uiRoot) appConf = appConf.replace(/^(\s*)root [^;\n]*main-server-ui\/dist;/gm, `$1root ${options.uiRoot};`);

  for (const [name, text] of [['main', mainConf], ['app', appConf]] as const) {
    for (const forbidden of ['/opt/homebrew/var/log', '/opt/homebrew/etc/openresty/conf.d']) {
      if (text.includes(forbidden)) throw new Error(`REFUSING TO START: the ${name} configuration still names ${forbidden} (nginx would write or read the machine's own)`);
    }
    const listens = [...text.matchAll(/^\s*listen\s+([^;]+);/gm)].map((m) => m[1]);
    for (const l of listens) {
      if (!l.startsWith('127.0.0.1:') && !(options.lanIp && l.startsWith(`${options.lanIp}:`))) throw new Error(`REFUSING TO START: ${name} configuration listens on ${JSON.stringify(l)}, not a disposable loopback port`);
    }
  }
  // `content_by_lua_file lua/handlers/x.lua` is relative to nginx's prefix: on the machine, the install's nginx dir. Here the
  // prefix is `dir`, so its `lua` is a link to the tree under test (the release's) or, without one, the installed tree.
  const luaTree = options.luaRoot ?? layout.luaDir;
  if (!luaTree || !fs.existsSync(luaTree)) throw new Error(`no Lua tree to serve the handlers from (${luaTree})`);
  fs.symlinkSync(luaTree, path.join(dir, 'lua'));
  const confPath = path.join(dir, 'nginx.conf');
  fs.writeFileSync(confPath, mainConf);
  fs.writeFileSync(path.join(confDDir, 'netget_app.conf'), appConf);
  fs.writeFileSync(path.join(dir, 'mime.types'), 'types { text/html html htm; text/css css; application/javascript js mjs; application/json json; image/svg+xml svg; text/plain txt; font/woff2 woff2; image/png png; }\n');

  const pid = path.join(dir, 'nginx.pid');
  const args = ['-p', dir, '-c', confPath, '-g', `pid ${pid};`];
  try {
    execFileSync(openresty, ['-t', ...args], { stdio: 'pipe' });
  } catch (e: any) {
    const why = String(e?.stderr ?? e?.message ?? e).split('\n').filter((l) => /emerg|error|failed/i.test(l)).slice(0, 4).join(' | ');
    throw new Error(`the generated configuration does not pass nginx -t (kept at ${dir}): ${why}`);
  }
  const child: ChildProcess = spawn(openresty, ['-p', dir, '-c', confPath, '-g', `pid ${pid}; daemon off;`], { stdio: 'ignore', env: { ...process.env } });

  const listening = (port: number) => new Promise<boolean>((r) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
  for (let i = 0; i < 80 && !(await listening(httpPort)); i += 1) await new Promise((r) => setTimeout(r, 100));
  if (!(await listening(httpPort))) { child.kill('SIGKILL'); throw new Error('the disposable OpenResty did not come up'); }

  const stop = async () => {
    if (child.exitCode === null) {
      try { execFileSync(openresty, ['-p', dir, '-c', confPath, '-g', `pid ${pid};`, '-s', 'quit'], { stdio: 'ignore' }); } catch { /* not running */ }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 6000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    // nothing may still hold the ports
    for (let i = 0; i < 30 && ((await listening(httpPort)) || (await listening(httpsPort))); i += 1) await new Promise((r) => setTimeout(r, 100));
    fs.rmSync(dir, { recursive: true, force: true });
  };

  return { dir, httpPort, httpsPort, origin: `http://127.0.0.1:${httpPort}`, mainConf, appConf, errorLogPath: path.join(logDir, 'error.log'), errorLogPaths: [path.join(logDir, 'error.log'), path.join(logDir, 'netget_error.log')], stop };
}
