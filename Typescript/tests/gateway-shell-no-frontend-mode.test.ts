import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The production shell has no control that switches how the main server is served (dev/Vite vs the built
// bundle). Switching namespaces is the control the page offers; serving the GUI is the server's business.
// The mechanism behind the old selector (`netget frontend-mode`, GET/POST /frontend-mode, the generator's
// modes) is deliberately still here and is covered by frontend-mode-switch.test.ts -- only the UI went.
const app = fs.readFileSync(path.resolve('src/htmls/Netget-REACT/frontend_local/src/App.jsx'), 'utf8');
assert.ok(!/FrontendModeLauncher/.test(app), 'App.jsx must not mount the frontend-mode selector');
assert.ok(!/footerExtras/.test(app), 'the gateway shell adds nothing to the sidebar footer');
assert.ok(/<Cleaker\b/.test(app), 'the gateway role is still the Cleaker shell');

const cli = fs.readFileSync(path.resolve('src/netget.cli.ts'), 'utf8');
assert.ok(/\.command\('frontend-mode \[mode\]'\)/.test(cli), 'the CLI switch for operators is untouched');
console.log('gateway-shell-no-frontend-mode: ok');
