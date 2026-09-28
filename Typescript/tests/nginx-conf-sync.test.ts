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

// detectOpenRestyLayout() answers with the machine's REAL paths. This test deletes and rewrites nginx.conf, so it
// must never be handed those: every path syncNginxConfigFile() writes (configFilePath, confDDir, logDir) is moved
// into this test's own directory. Before this, `npm test` overwrote the live /opt/homebrew/etc/openresty/nginx.conf
// on every run (2026-09-26: it left it pointing at a temp data dir that no longer existed).
const realLayout = detectOpenRestyLayout();
const fingerprint = (file: string) => (fs.existsSync(file) ? `${fs.statSync(file).mtimeMs}:${fs.readFileSync(file, 'utf8').length}` : 'absent');
const realBefore = realLayout.isSupported ? fingerprint(realLayout.configFilePath) : '';
const sandbox = path.join(tmpDataDir, 'openresty');
const layout = {
    ...realLayout,
    configDir: sandbox,
    confDDir: path.join(sandbox, 'conf.d'),
    logDir: path.join(sandbox, 'logs'),
    configFilePath: path.join(sandbox, 'nginx.conf'),
};
if (!layout.isSupported) {
    console.log('nginx-conf-sync skipped (unsupported platform)');
} else {
    assert.ok(!layout.configFilePath.startsWith(realLayout.configDir), 'the sandbox must not sit inside the real OpenResty config dir');
    // ── File doesn't exist yet: must create it, no prompt ──────────────────
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

    // the machine's real nginx.conf was not touched by any of the above
    assert.equal(fingerprint(realLayout.configFilePath), realBefore, 'the test must leave the real nginx.conf exactly as it found it');

    console.log('nginx-conf-sync ok');
}
