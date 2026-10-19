import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// buildNginxConfigContent() (setNginxConfigFile.ts) — the function that owns
// the default_server fix, the SSL wildcard-cert-lookup fallback, and the
// MAIN_SERVER_NAME bypass — had exactly one caller anywhere in the codebase
// before this: itself, from a private function only reachable via an
// interactive "reset nginx.conf?" confirm prompt nothing in `netget init`
// ever triggered. A fix landing in this file had no path to a running
// server short of hand-editing nginx.conf over SSH. syncNginxConfigFile()
// is the non-interactive counterpart `init` now calls on every run.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-nginxsync-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const { syncNginxConfigFile } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const { detectOpenRestyLayout } = await import('../src/modules/NetGetX/OpenResty/platformDetect.ts');

// This test used to point at the machine's REAL layout: it deleted /opt/homebrew/etc/openresty/nginx.conf, wrote
// 'stale content' into it and let the gateway template regenerate it with a temp data dir. Run on a machine with a
// gateway, that left the real main config reading its domain map, templates and html root from a temp dir (seen in a
// real nginx error log on 2026-10-08 and 2026-10-11, and on 2026-10-12 after a regression run). The layout here is a
// sandbox: every path is under the test's own temp dir, and the test refuses to run on anything else.
const real = detectOpenRestyLayout();
const sandbox = path.join(os.tmpdir(), `netget-nginxsync-layout-${process.pid}`);
const layout = {
    ...real,
    configDir: sandbox,
    confDDir: path.join(sandbox, 'conf.d'),
    logDir: path.join(sandbox, 'logs'),
    configFilePath: path.join(sandbox, 'nginx.conf'),
};
assert.ok(layout.configFilePath.startsWith(os.tmpdir()), 'the test writes only under the temp dir');
assert.notEqual(layout.configFilePath, real.configFilePath, 'and never to the installed nginx.conf');
const realBefore = real.isSupported && fs.existsSync(real.configFilePath) ? fs.statSync(real.configFilePath).mtimeMs : null;

if (!real.isSupported) {
    console.log('nginx-conf-sync skipped (unsupported platform)');
} else {
    // ── File doesn't exist yet: must create it, no prompt ──────────────────
    fs.mkdirSync(sandbox, { recursive: true });
    if (fs.existsSync(layout.configFilePath)) fs.rmSync(layout.configFilePath);
    const created = await syncNginxConfigFile(layout);
    assert.equal(created, true, 'must write nginx.conf when it does not exist yet, non-interactively');
    assert.ok(fs.existsSync(layout.configFilePath), 'nginx.conf must exist after sync');

    // ── Already matches: second call is a no-op ─────────────────────────────
    const secondCall = await syncNginxConfigFile(layout);
    assert.equal(secondCall, false, 'must not rewrite when content already matches the template');

    // ── File drifted (stale template, e.g. hand-patched or pre-fix): must
    // resync to the current template without asking ────────────────────────
    fs.writeFileSync(layout.configFilePath, 'stale content from a previous template version', 'utf8');
    const resynced = await syncNginxConfigFile(layout);
    assert.equal(resynced, true, 'must rewrite when the on-disk file differs from the current template');
    const content = fs.readFileSync(layout.configFilePath, 'utf8');
    assert.match(content, /listen 443 ssl default_server;/);

    // ── the installed file was not touched ──────────────────────────────────
    const realAfter = fs.existsSync(real.configFilePath) ? fs.statSync(real.configFilePath).mtimeMs : null;
    assert.equal(realAfter, realBefore, 'the installed nginx.conf was not touched');
    fs.rmSync(sandbox, { recursive: true, force: true });

    console.log('nginx-conf-sync ok');
}
