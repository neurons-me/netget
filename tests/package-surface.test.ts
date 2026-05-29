import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
    files?: string[];
    license?: string;
};

const files = pkg.files || [];

assert.equal(pkg.license, 'MIT');
assert.equal(pkg.bin?.netget, 'bin/netget');
assert.ok(files.includes('bin/'), 'package must include the executable wrapper');
assert.ok(files.includes('dist/'), 'package must include library build output');
assert.ok(files.includes('src/netget.cli.ts'), 'package must include the TS CLI entry while bin uses tsx');
assert.ok(files.includes('src/modules/**/*.ts'), 'package must include CLI module sources while bin uses tsx');
assert.ok(files.includes('src/runtime/**/*.ts'), 'package must include runtime sources while bin uses tsx');
assert.ok(files.includes('src/utils/netgetPaths.js'), 'package must include the source JS path helper used by TS CLI files');
assert.ok(files.includes('src/modules/NetGetX/OpenResty/lua/'), 'package must include Lua handlers for gateway install');
assert.ok(files.includes('assets/main-server-ui/dist/'), 'package must include only the bundled admin UI dist');

const forbidden = [
    'gui/',
    'main-server/',
    'main-server-ui/',
    'src/htmls/Netget-REACT',
    'docs/.vitepress/cache',
    'tests/',
];

for (const entry of files) {
    for (const blocked of forbidden) {
        assert.ok(!entry.startsWith(blocked), `package files allowlist must not include ${blocked}`);
    }
}

console.log('package-surface ok');
