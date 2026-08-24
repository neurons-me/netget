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

const layout = detectOpenRestyLayout();
if (!layout.isSupported) {
    console.log('nginx-conf-sync skipped (unsupported platform)');
} else {
    // ── File doesn't exist yet: must create it, no prompt ──────────────────
    if (fs.existsSync(layout.configFilePath)) fs.rmSync(layout.configFilePath);
    const created = await syncNginxConfigFile();
    assert.equal(created, true, 'must write nginx.conf when it does not exist yet, non-interactively');
    assert.ok(fs.existsSync(layout.configFilePath), 'nginx.conf must exist after sync');

    // ── Already matches: second call is a no-op ─────────────────────────────
    const secondCall = await syncNginxConfigFile();
    assert.equal(secondCall, false, 'must not rewrite when content already matches the template');

    // ── File drifted (stale template, e.g. hand-patched or pre-fix): must
    // resync to the current template without asking ────────────────────────
    fs.writeFileSync(layout.configFilePath, 'stale content from a previous template version', 'utf8');
    const resynced = await syncNginxConfigFile();
    assert.equal(resynced, true, 'must rewrite when the on-disk file differs from the current template');
    const content = fs.readFileSync(layout.configFilePath, 'utf8');
    assert.match(content, /listen 443 ssl default_server;/);

    console.log('nginx-conf-sync ok');
}
