import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

// A door with connections, in a real OpenResty, through BOTH doors:
//   host door   https://fulltrailer.<root>/...   (location /  -> surface_proxy.lua)
//   path door   http://localhost/apps/fulltrailer/...   (location ~ ^/apps/<name>/ -> monad_proxy.lua)
// The location blocks, the named locations and the Lua are the very text the generator emits and the repo's Lua files,
// in front of two tiny upstreams (a "monad" and the app's own server) that the test can switch off.
//
// What is checked:
//   * a declared prefix goes to the app's server with the path preserved (the /apps/<name> mount is the only thing
//     taken off) and with the query; its descendants too; /api/fuelAnything and /api/v1/* do not;
//   * an API path nobody serves is never the app's HTML: it is the monad's JSON 404, or JSON from the gateway;
//   * the server being off is JSON (502 connection_unavailable) and does not take the door's other paths down;
//   * a connection that is not allowed (target port is the gateway's, a registered monad's, not loopback) is an error,
//     never "the monad answers instead";
//   * what the app's server receives: none of the gateway's credentials, X-Forwarded-For replaced, not appended.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-door-conn-'));
const dataDir = path.join(tmp, 'data');
process.env.NETGET_DATA_DIR = dataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = path.join(tmp, 'live');
fs.mkdirSync(path.join(dataDir, 'runtime'), { recursive: true });
delete process.env.NETGET_GATEWAY_UPSTREAM;

const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
// DOOR_CONF_FILE: take the blocks from an installed-style netget_app.conf instead of the generator's output
const conf = process.env.DOOR_CONF_FILE ? fs.readFileSync(process.env.DOOR_CONF_FILE, 'utf8') : getNetgetAppConfContent();

// ── pieces of the generated conf ────────────────────────────────────────────
function block(from: number): string {
  let depth = 0;
  for (let i = conf.indexOf('{', from); i < conf.length; i += 1) {
    if (conf[i] === '{') depth += 1;
    else if (conf[i] === '}') { depth -= 1; if (depth === 0) return conf.slice(from, i + 1); }
  }
  throw new Error('unbalanced block');
}
const appsStart = conf.indexOf('location ~ ^/apps/([^/]+)(/.*)?$ {');
assert.ok(appsStart > 0, '/apps/<name> location is generated');
const appsBlock = block(appsStart);
assert.match(appsBlock, /monad_proxy\.lua/);
const slashStart = [...conf.matchAll(/location \/ \{/g)].map((m) => m.index!).find((i) => /surface_proxy\.lua/.test(block(i)));
assert.ok(slashStart !== undefined, 'the host door location is generated');
const slashBlock = block(slashStart!);
const setIdx = conf.indexOf('set $door_connection_target "";');
assert.ok(setIdx > 0, 'the door connection locations are generated');
const connStart = conf.indexOf('location @door_connection {');
const errStart = conf.indexOf('location @door_connection_error {');
assert.ok(connStart > setIdx && errStart > connStart);
const doorConnection = `    set $door_connection_target "";\n    set $door_connection_prefix "";\n${block(connStart)}\n${block(errStart)}`;
const meshError = block(conf.indexOf('location @mesh_gateway_error {'));
const cacheMap = (conf.match(/map \$upstream_http_cache_control \$netget_default_cache_control \{[\s\S]*?\n    \}/) ?? [''])[0];
// every server block that has @mesh_gateway_error has the door connection locations
assert.equal(
  (conf.match(/location @mesh_gateway_error \{/g) ?? []).length,
  (conf.match(/location @door_connection \{/g) ?? []).length,
  'each server block with @mesh_gateway_error also has @door_connection',
);
// the named location's own hygiene, as text: the gateway's credentials are blanked
const connText = block(connStart);
for (const header of ['X-Monad-Internal-Token', 'X-NetGet-Identity', 'X-NetGet-Scopes', 'X-Me-Proof', 'Authorization', 'Cookie']) {
  assert.match(connText, new RegExp(`proxy_set_header ${header} "";`), `${header} is blanked`);
}
assert.match(connText, /proxy_set_header X-Forwarded-For \$remote_addr;/, 'replaced, not appended (no $proxy_add_x_forwarded_for)');
assert.doesNotMatch(connText, /proxy_add_x_forwarded_for/);
assert.match(connText, /proxy_intercept_errors off;/);

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) {
  console.log('door-connections-openresty: generated conf checked; the OpenResty part is skipped (no openresty on this machine)');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

// ── upstreams ────────────────────────────────────────────────────────────────
const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });
const [monadPort, serverPort, otherMonadPort, nginxPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
const INDEX = '<!doctype html><title>FullTrailer</title><div id=root></div>';
function echo(who: string) {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      const body = Buffer.concat(chunks);
      if (who === 'monad' && url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(INDEX); return; }
      if (who === 'monad' && url.startsWith('/api/v1/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ who, ok: true, url })); return; }
      if (who === 'monad') { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ who, ok: false, url, host: req.headers.host })); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ who, url, method: req.method, host: req.headers.host, headers: req.headers, bytes: body.length, remote: req.socket.remoteAddress }));
    });
  });
}
const monad = echo('monad'); const appServer = echo('server'); const otherMonad = echo('monad');
const listen = (s: http.Server, p: number) => new Promise<void>((r) => s.listen(p, '127.0.0.1', () => r()));
await listen(monad, monadPort); await listen(appServer, serverPort); await listen(otherMonad, otherMonadPort);

// ── gateway data: registry + domain-map ─────────────────────────────────────
const ROOT = 'suis-macbook-air.local';
const FT_HOST = `fulltrailer.${ROOT}`;
const now = Date.now();
const regEntry = (name: string, port: number, exposure: Record<string, unknown> = { enabled: true, visibility: 'loopback', network: { allowLoopback: true, allowLan: false, allowWan: false } }) => ({
  name: `monad:${name}`, kind: 'monad', host: '127.0.0.1', port, protocol: 'http', ttlMs: 600000, lastSeenMs: now, trust: 'peer',
  tags: ['monad'], exposure,
  metadata: { monadName: name, namespace: `${name}.${ROOT}`, identity: `${name}.${ROOT}`, identity_hash: `${name}-id`,
    endpoint: `http://127.0.0.1:${port}`, directEndpoint: `http://127.0.0.1:${port}`, claimed_namespaces: [`${name}.${ROOT}`] },
});
const writeApps = (ftExposure?: Record<string, unknown>) => fs.writeFileSync(path.join(dataDir, 'runtime', 'apps.json'), JSON.stringify({ apps: { a: regEntry('fulltrailer', monadPort, ftExposure), b: regEntry('other', otherMonadPort) } }));
writeApps();
const writeMap = (connections: unknown) => fs.writeFileSync(path.join(dataDir, 'runtime', 'domain-map.json'), JSON.stringify({
  version: 1, domains: { [FT_HOST]: { type: 'server', target: 'app:fulltrailer', ssl: { enabled: false }, ...(connections === undefined ? {} : { connections }) } },
}));
const GOOD = [
  { prefix: '/api/fuel', target: `127.0.0.1:${serverPort}` },
  { prefix: '/api/upload', target: `127.0.0.1:${serverPort}` },
  { prefix: '/uploads', target: `127.0.0.1:${serverPort}` },
];
writeMap(GOOD);

// ── a real OpenResty with those blocks ──────────────────────────────────────
// DOOR_LUA_ROOT: run the same walk against another `lua/` tree (the files an installation would put in place)
const luaRoot = process.env.DOOR_LUA_ROOT ? path.resolve(process.env.DOOR_LUA_ROOT) : path.resolve('src/modules/NetGetX/OpenResty/lua');
// a peer that is NOT loopback: connect to this machine's own LAN address, so nginx sees that address as the client
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const prefix = path.join(tmp, 'or');
for (const d of ['conf', 'logs']) fs.mkdirSync(path.join(prefix, d), { recursive: true });
fs.symlinkSync(luaRoot, path.join(prefix, 'lua'));
fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'), `worker_processes 1;
pid ${path.join(prefix, 'logs', 'nginx.pid')};
error_log ${path.join(prefix, 'logs', 'error.log')} info;
env NETGET_DATA_DIR;
events { worker_connections 64; }
http {
    access_log off;
    lua_package_path "${luaRoot}/?.lua;;";
${cacheMap}
    server {
        listen 127.0.0.1:${nginxPort};
${lanIp ? `        listen ${lanIp}:${nginxPort};` : ''}
        server_name _;
        client_max_body_size 50m;
        set $door_entry "";
        set $door_status "";
${appsBlock}
${slashBlock}
${doorConnection}
${meshError}
    }
}
`);
const confPath = path.join(prefix, 'conf', 'nginx.conf');
execFileSync(openrestyBin, ['-t', '-p', prefix, '-c', confPath], { stdio: 'pipe' });
const nginx = spawn(openrestyBin, ['-p', prefix, '-c', confPath, '-g', 'daemon off;'], { stdio: 'ignore', env: { ...process.env, NETGET_DATA_DIR: dataDir } });
const listening = () => new Promise<boolean>((r) => { const c = net.connect(nginxPort, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
for (let i = 0; i < 60 && !(await listening()); i += 1) await new Promise((r) => setTimeout(r, 100));
assert.ok(await listening(), 'the disposable OpenResty is up');

type Res = { status: number; type: string; text: string; json: any; headers: http.IncomingHttpHeaders };
function request(opts: { host: string; path: string; method?: string; headers?: Record<string, string>; body?: Buffer; via?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: opts.via ?? '127.0.0.1', port: nginxPort, path: opts.path, method: opts.method ?? 'GET', headers: { Host: opts.host, ...(opts.headers ?? {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
const host = (p: string, o: Partial<Parameters<typeof request>[0]> = {}) => request({ host: FT_HOST, path: p, ...o });
const mount = (p: string, o: Partial<Parameters<typeof request>[0]> = {}) => request({ host: 'localhost', path: `/apps/fulltrailer${p}`, ...o });
const isHtmlOfApp = (r: Res) => r.text.includes('<title>FullTrailer</title>');

try {
  for (const [door, call] of [['host door', host], ['/apps/fulltrailer/ door', mount]] as const) {
    const at = (p: string) => (door === 'host door' ? p : p);   // the path the app's server must see is the same in both
    // the door's own destination still answers its front end
    const root = await call('/', { headers: { Accept: 'text/html' } });
    assert.equal(root.status, 200, `${door}: /`);
    assert.ok(isHtmlOfApp(root), `${door}: / is the app`);

    // a declared prefix goes to the app's server, path and query preserved
    const fuel = await call('/api/fuel?from=2026-10-01&x=%2F', { headers: { Accept: 'application/json' } });
    assert.equal(fuel.status, 200, `${door}: /api/fuel`);
    assert.equal(fuel.json?.who, 'server', `${door}: answered by the app's server`);
    assert.equal(fuel.json.url, at('/api/fuel?from=2026-10-01&x=%2F'), `${door}: path and query preserved, nothing of the mount`);
    assert.equal(fuel.headers['x-netget-connection'], '/api/fuel');

    // its descendants, and the other declared prefixes
    assert.equal((await call('/api/fuel/2026/10')).json?.who, 'server', `${door}: a descendant`);
    assert.equal((await call('/uploads/a.png')).json?.who, 'server', `${door}: /uploads`);
    const upload = await call('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(3 * 1024 * 1024, 1) });
    assert.equal(upload.json?.who, 'server');
    assert.equal(upload.json.method, 'POST');
    assert.equal(upload.json.bytes, 3 * 1024 * 1024, `${door}: a 3 MB upload reaches the server whole`);

    // not carved out: another path that starts with the same letters, the parent, and the monad's own /api/v1
    for (const p of ['/api/fuelAnything', '/api', '/api/nope', '/api/fue']) {
      const r = await call(p, { headers: { Accept: 'application/json' } });
      assert.equal(r.json?.who, 'monad', `${door}: ${p} is the monad's, not the server's`);
      assert.equal(r.status, 404, `${door}: ${p} does not exist -> 404`);
      assert.ok(!isHtmlOfApp(r), `${door}: ${p} never returns the HTML of the app`);
      assert.match(r.type, /json/, `${door}: ${p} is JSON`);
    }
    const v1 = await call('/api/v1/keychain/keys?namespace=x');
    assert.equal(v1.json?.who, 'monad', `${door}: /api/v1 stays with the monad`);

    // the gateway's credentials do not reach the app's server; X-Forwarded-For is replaced
    const spoof = await call('/api/fuel', { headers: {
      Authorization: 'Bearer admin-session-token', Cookie: 'jwt=abc', 'X-Monad-Internal-Token': 'internal',
      'X-NetGet-Identity': 'someone-else', 'X-Netget-Scopes': 'gateway:write', 'X-Me-Proof': 'proof', 'X-NetGet-Internal': '1',
      'X-NetGet-Monad': 'x', 'X-NetGet-Surface': 'y', 'X-NetGet-App-Kind': 'z', 'X-Forwarded-For': '1.2.3.4',
    } });
    const h = spoof.json.headers as Record<string, string>;
    for (const name of ['authorization', 'cookie', 'x-monad-internal-token', 'x-netget-identity', 'x-netget-scopes', 'x-me-proof',
      'x-netget-internal', 'x-netget-monad', 'x-netget-surface', 'x-netget-app-kind']) {
      assert.equal(h[name], undefined, `${door}: ${name} is not forwarded to the app's server`);
    }
    assert.equal(h['x-forwarded-for'], '127.0.0.1', `${door}: X-Forwarded-For is the real peer, the forged value is not passed on`);
    assert.equal(h['x-real-ip'], '127.0.0.1');
    assert.equal(spoof.json.host, door === 'host door' ? FT_HOST : 'localhost', `${door}: Host is the one the client used`);

    // the app's server is off: JSON from the gateway, and the rest of the door is unaffected
    appServer.close(); appServer.closeAllConnections?.();
    await new Promise((r) => setTimeout(r, 100));
    for (const accept of ['application/json', 'text/html']) {
      const down = await call('/api/fuel', { headers: { Accept: accept } });
      assert.equal(down.status, 502, `${door}: server off -> 502 (${accept})`);
      assert.match(down.type, /application\/json/, `${door}: JSON even for a browser (${accept})`);
      assert.equal(down.json?.error, 'connection_unavailable');
      assert.equal(down.json?.prefix, '/api/fuel');
      assert.ok(!isHtmlOfApp(down) && !/<html/i.test(down.text), `${door}: not a page`);
    }
    assert.equal((await call('/', { headers: { Accept: 'text/html' } })).status, 200, `${door}: the front end still answers`);
    assert.equal((await call('/api/v1/keychain/keys')).json?.who, 'monad', `${door}: the monad still answers`);
    await listen(appServer, serverPort);                       // back on for the next door
    assert.equal((await call('/api/fuel')).json?.who, 'server', `${door}: server back`);
  }

  // an app that is not this door's is untouched: /apps/other/... never goes to FullTrailer's server
  const other = await request({ host: 'localhost', path: '/apps/other/api/fuel' });
  assert.equal(other.json?.who, 'monad', 'another app keeps going to its own monad');

  // ── who may use a connection: the app's exposure policy, on the address that connected ──────────────────────────
  // FullTrailer's server has no authentication of its own (/api/fuel, /api/upload and /uploads answer anyone who reaches
  // them), so the gateway is the only thing between a stranger and the fleet's fuel data and a disk to write on.
  if (lanIp) {
    // policy: loopback only (what the real local FullTrailer has today). A LAN peer: refused, as JSON, on both doors
    const viaHost = await host('/api/fuel', { via: lanIp, headers: { Accept: 'application/json' } });
    assert.equal(viaHost.status, 403, 'host door, LAN peer, loopback-only policy');
    assert.equal(viaHost.json?.error, 'connection_forbidden');
    assert.notEqual(viaHost.json?.who, 'server');
    const viaMount = await mount('/api/fuel', { via: lanIp, headers: { Accept: 'application/json' } });
    assert.equal(viaMount.status, 403, '/apps/ door, LAN peer, loopback-only policy');
    assert.notEqual(viaMount.json?.who, 'server');
    assert.ok(!isHtmlOfApp(viaMount));
    for (const p of ['/api/upload', '/uploads/a.png']) {
      assert.equal((await host(p, { via: lanIp, method: p === '/api/upload' ? 'POST' : 'GET' })).status, 403, `${p} refused to the LAN peer`);
    }
    // the same peer is not locked out of the door's own front end by the connection gate (that is the monad's)
    assert.equal((await host('/', { via: lanIp, headers: { Accept: 'text/html' } })).status, 200);

    // policy: the operator admits the LAN -> the same peer is served, and the service sees ITS address, not 127.0.0.1
    writeApps({ enabled: true, visibility: 'lan', network: { allowLoopback: true, allowLan: true, allowWan: false } });
    const lanOk = await host('/api/fuel', { via: lanIp, headers: { 'X-Forwarded-For': '9.9.9.9' } });
    assert.equal(lanOk.json?.who, 'server', 'visibility lan admits the LAN peer');
    assert.equal(lanOk.json.headers['x-forwarded-for'], lanIp, 'the service sees the real peer (not loopback, not the forged one)');
    assert.equal((await mount('/api/fuel', { via: lanIp })).json?.who, 'server');

    // policy: disabled -> nothing, not even for a loopback peer
    writeApps({ enabled: false, visibility: 'loopback', network: { allowLoopback: true } });
    assert.equal((await host('/api/fuel')).status, 404, 'a disabled app has no connections');
    writeApps();   // back to the default policy
  } else {
    console.log('door-connections-openresty: no non-loopback IPv4 on this machine; the LAN-peer cases are skipped');
  }
  assert.equal((await host('/api/fuel')).json?.who, 'server', 'loopback peer, default policy: served');

  // ── connections that are not allowed: an error, never the monad answering in their place ──────────────────────
  const refused: Array<[string, unknown]> = [
    ['the gateway backend port', [{ prefix: '/api/fuel', target: '127.0.0.1:3000' }]],
    ['nginx port', [{ prefix: '/api/fuel', target: '127.0.0.1:443' }]],
    ['a registered monad by port', [{ prefix: '/api/fuel', target: `127.0.0.1:${monadPort}` }]],
    ['another registered monad by port', [{ prefix: '/api/fuel', target: `127.0.0.1:${otherMonadPort}` }]],
    ['not loopback', [{ prefix: '/api/fuel', target: '10.1.2.3:4000' }]],
    ['a hostname', [{ prefix: '/api/fuel', target: 'internal.example:4000' }]],
    ['a path in the target', [{ prefix: '/api/fuel', target: `127.0.0.1:${serverPort}/admin` }]],
    ['a prefix over the monad api', [{ prefix: '/api', target: `127.0.0.1:${serverPort}` }]],
  ];
  for (const [label, connections] of refused) {
    writeMap(connections);
    const prefixOf = (connections as any[])[0].prefix as string;
    for (const [door, call] of [['host door', host], ['mount door', mount]] as const) {
      const r = await call(prefixOf, { headers: { Accept: 'application/json' } });
      assert.equal(r.status, 502, `${label} (${door}): refused -> 502, got ${r.status} ${r.text.slice(0, 80)}`);
      assert.equal(r.json?.error, 'connection_not_applied', `${label} (${door})`);
      assert.notEqual(r.json?.who, 'monad', `${label} (${door}): the monad did not answer in its place`);
      assert.ok(!isHtmlOfApp(r), `${label} (${door}): not the HTML of the app`);
    }
    // and the door's front end is not taken down by a bad declaration
    assert.equal((await host('/', { headers: { Accept: 'text/html' } })).status, 200, `${label}: the front end still answers`);
  }

  // a prefix on the mount itself can never match (the mount is taken off before a connection is looked up) and is
  // refused when it is declared (door-connections.test.ts); a file that carries it anyway does not make the server answer
  writeMap([{ prefix: '/apps/fulltrailer', target: `127.0.0.1:${serverPort}` }]);
  for (const p of ['/apps/fulltrailer', '/apps/fulltrailer/api/fuel']) {
    const r = await request({ host: 'localhost', path: p, headers: { Accept: 'application/json' } });
    assert.notEqual(r.json?.who, 'server', `${p}: the server does not answer through a prefix on the mount`);
  }

  // no connections declared: the door is exactly what it was
  writeMap(undefined);
  assert.equal((await host('/api/fuel')).json?.who, 'monad', 'without connections /api/fuel is the monad\'s (404 JSON)');
  assert.equal((await host('/api/fuel')).status, 404);
} finally {
  nginx.kill();
  monad.close(); appServer.close(); otherMonad.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('door-connections-openresty: ok');
process.exit(0);
