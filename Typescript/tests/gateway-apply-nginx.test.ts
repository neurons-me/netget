import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Applying the gateway's nginx config + Lua as a pair: backed up first,
// validated before any reload, and put back if it does not hold. The
// validator and the reload are fakes here; the filesystem is a temp dir.

const { applyGatewayNginx, diffGatewayNginx, lineDiff, systemIo } = await import('../src/gateway/applyNginx.ts');

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-apply-nginx-'));
  const confPath = path.join(tmp, 'conf.d', 'netget_app.conf');
  const luaDir = path.join(tmp, 'lua');
  const sourceLuaDir = path.join(tmp, 'src-lua');
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  fs.mkdirSync(path.join(luaDir, 'handlers'), { recursive: true });
  fs.mkdirSync(path.join(sourceLuaDir, 'handlers'), { recursive: true });
  fs.writeFileSync(confPath, 'OLD CONF');
  fs.writeFileSync(path.join(luaDir, 'handlers', 'apps.lua'), 'old lua');
  fs.writeFileSync(path.join(sourceLuaDir, 'handlers', 'apps.lua'), 'new lua');
  fs.writeFileSync(path.join(sourceLuaDir, 'handlers', 'extra.lua'), 'added lua');
  return { tmp, confPath, luaDir, sourceLuaDir, backupDir: path.join(tmp, 'backup') };
}

// the real filesystem operations, with a fake validator and reload
function io(fx: ReturnType<typeof fixture>, opts: { valid: boolean; reloadThrows?: boolean }) {
  const base = systemIo('/nonexistent/openresty', '/nonexistent/nginx.conf');
  const calls: string[] = [];
  return {
    calls,
    io: {
      ...base,
      validate: () => { calls.push('validate'); return opts.valid ? { ok: true, output: 'test is successful' } : { ok: false, output: '[emerg] bad directive' }; },
      reload: () => { calls.push('reload'); if (opts.reloadThrows && calls.filter((c) => c === 'reload').length === 1) throw new Error('reload refused'); },
    },
  };
}

// a valid config: written, Lua synced, reloaded, and the old ones are kept
{
  const fx = fixture();
  const { io: fake, calls } = io(fx, { valid: true });
  const result = applyGatewayNginx({ ...fx, newConf: 'NEW CONF', io: fake });
  assert.equal(result.ok, true);
  assert.equal(result.reloaded, true);
  assert.deepEqual(calls, ['validate', 'reload']);
  assert.equal(fs.readFileSync(fx.confPath, 'utf8'), 'NEW CONF');
  assert.equal(fs.readFileSync(path.join(fx.luaDir, 'handlers', 'apps.lua'), 'utf8'), 'new lua');
  assert.equal(fs.readFileSync(path.join(fx.luaDir, 'handlers', 'extra.lua'), 'utf8'), 'added lua');
  assert.equal(fs.readFileSync(path.join(fx.backupDir, 'netget_app.conf'), 'utf8'), 'OLD CONF');
  assert.equal(fs.readFileSync(path.join(fx.backupDir, 'lua', 'handlers', 'apps.lua'), 'utf8'), 'old lua');
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

// an invalid config: never reloaded, and both the conf and the Lua are put back exactly
{
  const fx = fixture();
  const { io: fake, calls } = io(fx, { valid: false });
  const result = applyGatewayNginx({ ...fx, newConf: 'BROKEN CONF', io: fake });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.reloaded, false);
  assert.match(result.message, /\[emerg\] bad directive/);
  assert.deepEqual(calls, ['validate'], 'no reload for a config that did not validate');
  assert.equal(fs.readFileSync(fx.confPath, 'utf8'), 'OLD CONF');
  assert.equal(fs.readFileSync(path.join(fx.luaDir, 'handlers', 'apps.lua'), 'utf8'), 'old lua');
  assert.equal(fs.existsSync(path.join(fx.luaDir, 'handlers', 'extra.lua')), false, 'files the new Lua added are gone again');
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

// a reload that fails: restored, and the restored config is reloaded again
{
  const fx = fixture();
  const { io: fake, calls } = io(fx, { valid: true, reloadThrows: true });
  const result = applyGatewayNginx({ ...fx, newConf: 'NEW CONF', io: fake });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(calls, ['validate', 'reload', 'reload']);
  assert.equal(fs.readFileSync(fx.confPath, 'utf8'), 'OLD CONF');
  assert.equal(fs.readFileSync(path.join(fx.luaDir, 'handlers', 'apps.lua'), 'utf8'), 'old lua');
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

// a first install (nothing there yet) has nothing to back up and nothing to restore to
{
  const fx = fixture();
  fs.rmSync(fx.confPath);
  const { io: fake } = io(fx, { valid: true });
  const result = applyGatewayNginx({ ...fx, newConf: 'FIRST CONF', io: fake });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(fx.confPath, 'utf8'), 'FIRST CONF');
  assert.equal(fs.existsSync(path.join(fx.backupDir, 'netget_app.conf')), false);
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

// the main nginx.conf goes in the same step: backed up, validated together, and put back with the rest
{
  const fx = fixture();
  const mainPath = path.join(fx.tmp, 'conf', 'nginx.conf');
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, 'OLD MAIN');
  const good = io(fx, { valid: true });
  const ok = applyGatewayNginx({ ...fx, newConf: 'NEW CONF', mainConf: { path: mainPath, content: 'NEW MAIN' }, io: good.io });
  assert.equal(ok.ok, true);
  assert.equal(fs.readFileSync(mainPath, 'utf8'), 'NEW MAIN');
  assert.equal(fs.readFileSync(path.join(fx.backupDir, 'main-nginx.conf'), 'utf8'), 'OLD MAIN');
  assert.equal(fs.readFileSync(path.join(fx.backupDir, 'netget_app.conf'), 'utf8'), 'OLD CONF');
  fs.rmSync(fx.tmp, { recursive: true, force: true });

  for (const failure of [{ valid: false }, { valid: true, reloadThrows: true }] as const) {
    const g = fixture();
    const main2 = path.join(g.tmp, 'conf', 'nginx.conf');
    fs.mkdirSync(path.dirname(main2), { recursive: true });
    fs.writeFileSync(main2, 'OLD MAIN');
    const bad = io(g, failure);
    const r = applyGatewayNginx({ ...g, newConf: 'NEW CONF', mainConf: { path: main2, content: 'BROKEN MAIN' }, io: bad.io });
    assert.equal(r.ok, false); assert.equal(r.rolledBack, true);
    assert.equal(fs.readFileSync(main2, 'utf8'), 'OLD MAIN', 'the main conf is put back exactly');
    assert.equal(fs.readFileSync(g.confPath, 'utf8'), 'OLD CONF');
    assert.equal(fs.readFileSync(path.join(g.luaDir, 'handlers', 'apps.lua'), 'utf8'), 'old lua');
    fs.rmSync(g.tmp, { recursive: true, force: true });
  }
}

// without mainConf the main conf is not touched
{
  const fx = fixture();
  const mainPath = path.join(fx.tmp, 'conf', 'nginx.conf');
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, 'OLD MAIN');
  applyGatewayNginx({ ...fx, newConf: 'NEW CONF', io: io(fx, { valid: true }).io });
  assert.equal(fs.readFileSync(mainPath, 'utf8'), 'OLD MAIN');
  assert.equal(fs.existsSync(path.join(fx.backupDir, 'main-nginx.conf')), false);
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

// --diff says what would change and writes nothing
{
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nb\nc'), []);
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nx\nc'), ['@@', ' a', '-b', '+x', ' c'].slice(0, 5));
  const fx = fixture();
  const mainPath = path.join(fx.tmp, 'conf', 'nginx.conf');
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, 'one\ntwo\nthree');
  const text = diffGatewayNginx({
    io: systemIo('/nonexistent/openresty', '/nonexistent/nginx.conf'), confPath: fx.confPath, newConf: 'NEW CONF',
    mainConf: { path: mainPath, content: 'one\n2\nthree' }, luaDir: fx.luaDir, sourceLuaDir: fx.sourceLuaDir,
  });
  assert.match(text, /netget_app\.conf: 1 lines removed, 1 added/);
  assert.match(text, /nginx\.conf: 1 lines removed, 1 added/);
  assert.match(text, /-two\n\+2/);
  assert.match(text, /# lua: 2 files differ/);
  assert.match(text, /~ handlers\/apps\.lua/); assert.match(text, /\+ handlers\/extra\.lua \(new\)/);
  assert.equal(fs.readFileSync(fx.confPath, 'utf8'), 'OLD CONF'); assert.equal(fs.readFileSync(mainPath, 'utf8'), 'one\ntwo\nthree');
  assert.equal(fs.readFileSync(path.join(fx.luaDir, 'handlers', 'apps.lua'), 'utf8'), 'old lua');
  assert.match(diffGatewayNginx({ io: systemIo('/x', '/y'), confPath: fx.confPath, newConf: 'OLD CONF', luaDir: fx.luaDir, sourceLuaDir: fx.luaDir }), /main nginx\.conf: not included/);
  fs.rmSync(fx.tmp, { recursive: true, force: true });
}

console.log('gateway-apply-nginx.test.ts: all assertions passed');
process.exit(0);
