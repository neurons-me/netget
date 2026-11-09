import assert from 'node:assert/strict';
import fs from 'node:fs';

// Every gateway screen is the same minimal page with cleaker.js (one tree): the two Lua-rendered templates and the static
// page the default server answers an unknown host with. None loads a second copy of the GUI (this.gui.umd.js + React).
const pages = {
  'src/htmls/GatewayStatus.html': ['{{STATE}}', '{{HOST}}', '{{TARGET}}', '{{PUBLIC_IP}}', '{{MAIN_SERVER}}', '{{DEV_SERVER_BUTTON}}'],
  'assets/namespace-surface/no-monad.html': ['{{HOST}}', '{{ROOTSPACE}}', '{{HINT}}', '{{ERROR}}', '{{HOST_JSON}}'],
  'assets/gateway-pages/unknown-host.html': [],
};
for (const [file, placeholders] of Object.entries(pages)) {
  const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/this\.gui@\d+\.\d+\.\d+\/dist\/cleaker\.js" integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"/, `${file}: cleaker.js, pinned with SRI`);
  assert.doesNotMatch(html, /this\.gui\.umd\.js|vendor\/react|ns-assets|unpkg\.com/, `${file}: no second copy of the GUI`);
  for (const p of placeholders) assert.ok(html.includes(p), `${file}: keeps ${p} (filled by the Lua renderer)`);
  if (!placeholders.length) assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/, `${file}: static, no placeholder`);
}
console.log('gateway-pages: ok');
