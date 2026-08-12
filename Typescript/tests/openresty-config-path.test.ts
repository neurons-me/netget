import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { validateOpenRestyConfig } = await import('../src/modules/NetGetX/OpenResty/platformDetect.ts');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-openresty-bin-'));
const fakeOpenResty = path.join(tmpDir, 'openresty');
fs.writeFileSync(
  fakeOpenResty,
  '#!/bin/sh\nprintf "%s\\n" "$@"\n',
  'utf8',
);
fs.chmodSync(fakeOpenResty, 0o755);

const validation = validateOpenRestyConfig(fakeOpenResty, '/tmp/netget-nginx.conf');
assert.equal(validation.ok, true);
assert.deepEqual(validation.output.split('\n'), ['-t', '-c', '/tmp/netget-nginx.conf']);

const serviceSource = fs.readFileSync(
  path.join(process.cwd(), 'src/modules/NetGetX/OpenResty/openRestyService.ts'),
  'utf8',
);

assert.match(serviceSource, /<string>-c<\/string>\s*<string>\$\{configFilePath\}<\/string>/);
assert.match(serviceSource, /ExecStart=\$\{bin\} -c \$\{configFilePath\} -g 'daemon off;'/);
assert.match(serviceSource, /ExecReload=\$\{bin\} -c \$\{configFilePath\} -s reload/);
assert.match(serviceSource, /validateOpenRestyConfig\(bin, layout\.configFilePath\)/);

const includeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/modules/NetGetX/OpenResty/includeNetgetAppConf.ts'),
  'utf8',
);

assert.match(includeSource, /systemctl reload com\.netget\.openresty/);
assert.match(includeSource, /-c \$\{shellQuote\(layout\.configFilePath\)\} -s reload/);

console.log('openresty-config-path ok');
