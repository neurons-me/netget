import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What this file verifies, against the CURRENT selection contract (surface_proxy.lua, header comment; commit 89c5d9f):
//   - a registration's trust tier (owner > admin > peer > guest) is NOT a selector. It used to rank candidates before
//     recency; two identities claiming one host are now a CONFLICT that is answered, never resolved by trust or by
//     recency, so a more trusted registration cannot take a host another identity declared;
//   - a route the operator DECLARED for the host decides, whatever the trust of a rival claimant;
//   - one identity registered more than once is still one identity: it serves, and its identity_hash is exposed as
//     surface_proxy_identity (the winning identity the response header forwards);
//   - every mesh-routed server block (bare hostname, NRP handle, non-main-server public domains) declares that var and
//     forwards it as the X-NetGet-Identity response header (second half of this file).
// The behavioral part runs the handler in resty; where resty is not installed it is skipped, the config part is not.

const resty = ['/usr/local/openresty/bin/resty', '/opt/homebrew/bin/resty', '/usr/local/bin/resty'].find((p) => fs.existsSync(p));
const harness = fileURLToPath(new URL('./lua/surface_proxy_harness.lua', import.meta.url));
const handler = fileURLToPath(new URL('../src/modules/NetGetX/OpenResty/lua/handlers/surface_proxy.lua', import.meta.url));
const ROOT = 'suis-macbook-air.local';
const HOST = `shared.${ROOT}`;
const FRESH = 1_999_000;

type Trust = 'owner' | 'admin' | 'peer' | 'guest';
const registration = (name: string, identity: string, port: number, trust: Trust, seen = FRESH) => ({
    name: `monad:${name}`, host: '127.0.0.1', port, ttlMs: 12000, lastSeenMs: seen, trust,
    tags: ['127.0.0.1', 'local', 'monad', ROOT, `surface:${name}`],
    metadata: {
        monadName: name, namespace: `${name}.${ROOT}`, identity: `${name}.${ROOT}`, identity_hash: identity,
        endpoint: `http://127.0.0.1:${port}`, directEndpoint: `http://127.0.0.1:${port}`,
        claimed_namespaces: [`${name}.${ROOT}`, HOST],
    },
});

function decide(apps: any[], map?: Record<string, any>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-sel-'));
    try {
        fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'runtime', 'apps.json'), JSON.stringify({ apps: Object.fromEntries(apps.map((a, i) => [`id${i}`, a])) }));
        if (map) fs.writeFileSync(path.join(dir, 'runtime', 'domain-map.json'), JSON.stringify({ version: 1, domains: map }));
        const r = spawnSync(resty!, [harness, handler, dir, HOST, 'application/json'], { env: { ...process.env, NETGET_DATA_DIR: dir }, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        return JSON.parse(r.stdout.trim().split('\n').pop() as string) as { exit?: number; target: string; identity: string; reason?: string };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
const served = (r: { exit?: number; target: string }) => r.exit === undefined && r.target !== '';

if (!resty) {
    console.log('trust-aware-mesh-routing: behavioral part skipped (no resty on this machine)');
} else {
    const tiers: Trust[] = ['owner', 'admin', 'peer', 'guest'];

    // 1. two identities declare the host: a conflict whatever the tiers, in either order -- the higher tier does not win
    for (const high of tiers) {
        for (const low of tiers) {
            if (high === low) continue;
            const a = registration('alpha', 'alpha-identity', 4101, high);
            const b = registration('beta', 'beta-identity', 4102, low, FRESH + 500); // and the more recent
            for (const apps of [[a, b], [b, a]]) {
                const r = decide(apps);
                assert.ok(!served(r) && r.exit === 503, `${high} vs ${low}: a conflict is answered, not served (${JSON.stringify(r)})`);
                assert.ok(/conflict/.test(r.reason ?? ''), `${high} vs ${low}: says conflict (${r.reason})`);
            }
        }
    }

    // 2. the declared route decides, even when the rival claimant has the higher tier
    const declared = { [HOST]: { type: 'proxy', target: 'app:alpha', protocol: 'http', ssl: { enabled: false } } };
    const weakDeclared = registration('alpha', 'alpha-identity', 4101, 'guest');
    const strongRival = registration('beta', 'beta-identity', 4102, 'owner', FRESH + 500);
    for (const apps of [[weakDeclared, strongRival], [strongRival, weakDeclared]]) {
        const r = decide(apps, declared);
        assert.ok(served(r) && r.identity === 'alpha-identity' && r.target === 'http://127.0.0.1:4101', `declared guest beats an owner claimant: ${JSON.stringify(r)}`);
    }
    // and a declared target that is down is "not available": the stronger claimant does not inherit the host
    const down = decide([registration('alpha', 'alpha-identity', 4101, 'guest', 1_000_000), strongRival], declared);
    assert.ok(!served(down) && down.exit === 503, 'declared + down = not available, never the owner claimant');

    // 3. one identity registered twice (two ports, two tiers, two ages) is one identity: it serves, and its identity is exposed
    const older = registration('alpha', 'alpha-identity', 4101, 'peer', FRESH - 4000);
    const newer = registration('alpha', 'alpha-identity', 4111, 'owner', FRESH);
    for (const apps of [[older, newer], [newer, older]]) {
        const r = decide(apps);
        assert.ok(served(r), `one identity is not a conflict: ${JSON.stringify(r)}`);
        assert.equal(r.identity, 'alpha-identity', 'the winning identity is what X-NetGet-Identity forwards');
        assert.equal(r.target, 'http://127.0.0.1:4111', 'the most recent registration of THAT identity serves');
    }
}

// --- Generated config: mesh blocks declare + forward the identity var ---

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
const tmpLeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-le-'));
const publicDomain = 'mesh.example';

fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });
fs.writeFileSync(
    path.join(tmpDataDir, 'xConfig.json'),
    JSON.stringify({ mainServerFrontendMode: 'package-dist' }, null, 2),
    'utf8'
);
fs.writeFileSync(
    path.join(tmpDataDir, 'runtime', 'domain-map.json'),
    JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        node: { hostname: 'test-host' },
        domains: {
            [publicDomain]: { type: 'proxy', target: 'http://127.0.0.1:3000', protocol: 'http', ssl: { enabled: true } },
        },
    }, null, 2),
    'utf8'
);
const certDir = path.join(tmpLeDir, publicDomain);
fs.mkdirSync(certDir, { recursive: true });
fs.writeFileSync(path.join(certDir, 'fullchain.pem'), 'fake-fullchain', 'utf8');
fs.writeFileSync(path.join(certDir, 'privkey.pem'), 'fake-privkey', 'utf8');

process.env.NETGET_DATA_DIR = tmpDataDir;
process.env.NETGET_LETSENCRYPT_LIVE_DIR = tmpLeDir;

const { getNetgetAppConfContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
const conf = getNetgetAppConfContent();

const varCount = (conf.match(/set \$surface_proxy_identity "";/g) || []).length;
const headerCount = (conf.match(/add_header X-NetGet-Identity \$surface_proxy_identity always;/g) || []).length;

// Bare hostname block + NRP handle block + this one public (non-main) domain block = 3.
assert.equal(varCount, 3, `expected 3 mesh blocks to declare surface_proxy_identity, found ${varCount}`);
assert.equal(headerCount, 3, `expected 3 mesh blocks to forward X-NetGet-Identity, found ${headerCount}`);

console.log('trust-aware-mesh-routing.test.ts passed');
