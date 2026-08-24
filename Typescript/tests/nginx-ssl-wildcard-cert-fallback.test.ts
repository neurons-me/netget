import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Real production bug, found live on netget.site right after fixing the
// default_server issue (nginx-ssl-catchall-default-server.test.ts): the
// SSL cert-selection lookup (ssl_certificate_by_lua_block) did an exact
// `map.domains[host]` lookup only — no fallback to a wildcard entry
// (`*.parent.domain`) when the exact host wasn't registered. The routing
// lookup a few blocks later in the same file (the domain-target resolver)
// already implements this exact fallback; the cert-selection block just
// never had it. Practical effect: a wildcard cert genuinely issued and
// present for `*.example.com` was never served to `www.example.com` (or
// any other non-literally-registered subdomain) — ssl.clear_certs() ran,
// found no route, returned with no certificate at all, which browsers show
// as a hard connection failure (ERR_SSL_VERSION_OR_CIPHER_MISMATCH), not
// even a mismatched-name warning.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
process.env.NETGET_DATA_DIR = tmpDataDir;

const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');
const conf = buildNginxConfigContent();

// Anchor on the ssl_certificate_by_lua_block specifically (there is a
// second, separately-already-correct wildcard fallback later in the file,
// for domain-target routing — this must not accidentally match that one).
const certBlockStart = conf.indexOf('ssl_certificate_by_lua_block');
assert.ok(certBlockStart > -1, 'ssl_certificate_by_lua_block must be present');
const certBlockEnd = conf.indexOf('\n        }', certBlockStart);
const certBlock = conf.slice(certBlockStart, certBlockEnd);

assert.match(
    certBlock,
    /local route = map\.domains\[host\]\s*\n\s*if not route then\s*\n\s*local wildcard = host:match\("\[\^\.\]\+%\.\(\.\+\)"\)\s*\n\s*if wildcard then\s*\n\s*route = map\.domains\["\*\." \.\. wildcard\]/,
    'SSL cert selection must fall back to the *.parent-domain entry when the exact host has no domain-map entry, same as the routing lookup already does',
);

console.log('nginx-ssl-wildcard-cert-fallback ok');
