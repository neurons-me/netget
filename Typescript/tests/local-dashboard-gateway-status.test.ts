import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The local.netget/127.0.0.1/localhost control-plane block proxies to the
// Vite dev server when mainServerFrontendMode is 'dev'. If that dev server
// isn't running (e.g. after a reboot, before `npm run dev` was started
// again), nginx would otherwise return a bare, unbranded 502. This test
// verifies getNetgetAppConfContent() wires the same State 4
// (SERVICE_UNAVAILABLE) GatewayStatus.html path used elsewhere in the
// gateway (see gateway-status.test.ts) into that block too, in dev mode
// only — dist mode serves static files directly and doesn't proxy.

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });

const mainServerName = 'netget.site';

function writeXConfig(mainServerFrontendMode: string): void {
    fs.writeFileSync(
        path.join(tmpDataDir, 'xConfig.json'),
        JSON.stringify({ mainServerName, mainServerFrontendMode }, null, 2),
        'utf8',
    );
}

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
            if (char === '{') { depth += 1; opened = true; }
            if (char === '}') depth -= 1;
            if (opened && depth === 0) {
                blocks.push(source.slice(start, i + 1));
                searchFrom = i + 1;
                break;
            }
        }
    }
}

function localDashboardBlockFor(conf: string): string {
    const block = extractServerBlocks(conf).find((candidate) => candidate.includes('server_name local.netget'));
    assert.ok(block, 'expected a local.netget control-plane server block');
    return block!;
}

process.env.NETGET_DATA_DIR = tmpDataDir;
const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');

// Dev mode: local.netget proxies to the Vite dev server — must have the
// branded fallback wired in.
writeXConfig('dev');
const devConf = getNetgetAppConfContent();
const devBlock = localDashboardBlockFor(devConf);

assert.match(devBlock, /proxy_pass http:\/\/127\.0\.0\.1:5173;/);
assert.match(devBlock, /proxy_intercept_errors on;\s*\n\s*error_page 502 503 504 = @netget_panel_unavailable;/);
assert.match(devBlock, /location @netget_panel_unavailable \{/);
assert.match(devBlock, /render_gateway_status and _G\.render_gateway_status\(4, host, "http:\/\/127\.0\.0\.1:5173"\)/);

// Dist mode: local.netget serves static files directly — no proxy, so no
// need for the proxy-error fallback location.
writeXConfig('package-dist');
const distConf = getNetgetAppConfContent();
const distBlock = localDashboardBlockFor(distConf);

assert.doesNotMatch(distBlock, /@netget_panel_unavailable/);

console.log('local-dashboard-gateway-status ok');
