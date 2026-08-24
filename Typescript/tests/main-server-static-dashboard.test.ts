import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
const tmpLeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-le-'));

const publicIP = '34.28.109.244';
const localIP = '10.128.0.13';
const mainServerName = 'netget.site';
const appDomain = 'app.example';

fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });
fs.writeFileSync(
    path.join(tmpDataDir, 'xConfig.json'),
    JSON.stringify({ mainServerName, publicIP, localIP, mainServerFrontendMode: 'package-dist' }, null, 2),
    'utf8'
);
fs.writeFileSync(
    path.join(tmpDataDir, 'runtime', 'domain-map.json'),
    JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        node: { hostname: 'test-host' },
        domains: {
            [mainServerName]: { type: 'server', target: 'http://127.0.0.1:3432', protocol: 'http', ssl: { enabled: true } },
            [appDomain]: { type: 'proxy', target: 'http://127.0.0.1:3000', protocol: 'http', ssl: { enabled: true } },
        },
    }, null, 2),
    'utf8'
);

for (const domain of [mainServerName, appDomain]) {
    const certDir = path.join(tmpLeDir, domain);
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(path.join(certDir, 'fullchain.pem'), 'fake-fullchain', 'utf8');
    fs.writeFileSync(path.join(certDir, 'privkey.pem'), 'fake-privkey', 'utf8');
}

process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = tmpLeDir;

const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

const conf = getNetgetAppConfContent();

function extractServerBlocks(source: string): string[] {
    const blocks: string[] = [];
    let searchFrom = 0;

    while (true) {
        const start = source.indexOf('server {', searchFrom);
        if (start === -1) return blocks;

        let depth = 0;
        let opened = false;
        for (let i = start; i < source.length; i += 1) {
            const char = source[i];
            if (char === '{') {
                depth += 1;
                opened = true;
            }
            if (char === '}') depth -= 1;
            if (opened && depth === 0) {
                blocks.push(source.slice(start, i + 1));
                searchFrom = i + 1;
                break;
            }
        }
    }
}

function serverBlockFor(serverName: string): string {
    const block = extractServerBlocks(conf).find(candidate => candidate.includes(`server_name ${serverName};`));
    assert.ok(block, `expected server block for ${serverName}`);
    return block;
}

const mainPublicBlock = serverBlockFor(mainServerName);
assert.match(mainPublicBlock, /try_files \$uri \$uri\/ \/index\.html;/);
assert.match(mainPublicBlock, /content_by_lua_file lua\/handlers\/apps\.lua;/);
// Since the Domain Store Split-Brain fix, /domains proxy_passes straight to
// the daemon (localNetget.js, kernel-backed domainStore.ts) — domains.lua
// no longer exists.
assert.match(mainPublicBlock, /location \/domains \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3000\/domains;[\s\S]*?\}/);
assert.doesNotMatch(mainPublicBlock, /content_by_lua_file lua\/handlers\/domains\.lua/);
assert.doesNotMatch(mainPublicBlock, /surface_proxy\.lua/);
assert.doesNotMatch(mainPublicBlock, /proxy_pass \$surface_proxy_target/);

const appPublicBlock = serverBlockFor(appDomain);
assert.match(appPublicBlock, /rewrite_by_lua_file lua\/handlers\/surface_proxy\.lua;/);
assert.match(appPublicBlock, /proxy_pass \$surface_proxy_target;/);
assert.doesNotMatch(appPublicBlock, /content_by_lua_file lua\/handlers\/apps\.lua;/);

const machineHostname = (() => {
    const hostname = os.hostname().toLowerCase();
    return hostname.endsWith('.local') ? hostname : `${hostname}.local`;
})();
const namespaceBlock = serverBlockFor(machineHostname);
assert.doesNotMatch(namespaceBlock, new RegExp(publicIP.replaceAll('.', '\\.')));
assert.doesNotMatch(namespaceBlock, new RegExp(localIP.replaceAll('.', '\\.')));
assert.match(namespaceBlock, /rewrite_by_lua_file lua\/handlers\/surface_proxy\.lua;/);

const localDashboardBlock = serverBlockFor(`local.netget ${machineHostname.replace(/\.local$/, '')}.netget localhost 127.0.0.1 ${localIP} ${publicIP}`);
assert.match(localDashboardBlock, /try_files \$uri \$uri\/ \/index\.html;/);
assert.match(localDashboardBlock, /content_by_lua_file lua\/handlers\/apps\.lua;/);
assert.doesNotMatch(localDashboardBlock, /surface_proxy\.lua/);

console.log('main-server-static-dashboard ok');
