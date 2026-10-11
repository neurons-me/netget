import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// How netget knows its own addresses: a bounded, shared detector that keeps the last known value, never throws, and
// writes xConfig only; and /ip-info, which only reads and keeps the private address off the public answer.
const m = await import('../src/modules/utils/networkIdentity.ts');
const { isPrivateIPv4, isPublicIPv4, detectPublicIP, nextPublicIP, ensureNetworkIdentity, describePublicAddress } = m;

// ---- address classes
for (const ip of ['10.128.0.13', '192.168.1.5', '172.16.0.1', '172.31.255.255', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0']) {
  assert.equal(isPrivateIPv4(ip), true, `${ip} is private`);
  assert.equal(isPublicIPv4(ip), false, `${ip} is not public`);
}
for (const ip of ['34.28.109.244', '8.8.8.8', '172.32.0.1', '100.63.0.1', '203.0.113.9']) assert.equal(isPublicIPv4(ip), true, `${ip} is public`);
for (const v of ['', 'not available', '999.1.1.1', '1.2.3', '224.0.0.1', '255.255.255.255', null, undefined, 12]) assert.equal(isPublicIPv4(v as any), false, `${String(v)} is not a public IPv4`);

// ---- detection: bounded, and anything but a public IPv4 is a failure, never a value
const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
assert.deepEqual(await detectPublicIP({ fetchImpl: answer({ ip: '34.28.109.244' }) as any }), { ok: true, ip: '34.28.109.244' });
assert.deepEqual(await detectPublicIP({ fetchImpl: answer({}, 503) as any }), { ok: false, error: 'HTTP 503' });
assert.equal((await detectPublicIP({ fetchImpl: answer({ ip: 'hello' }) as any })).ok, false);
assert.equal((await detectPublicIP({ fetchImpl: answer({ ip: '10.0.0.4' }) as any })).ok, false, 'a private answer is not an observation');
assert.equal((await detectPublicIP({ fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as any })).ok, false);
const hang = (async (_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any;
const t0 = Date.now();
const timedOut = await detectPublicIP({ fetchImpl: hang, timeoutMs: 120 });
assert.equal(timedOut.ok, false);
assert.match((timedOut as any).error, /no answer within 120 ms/);
assert.ok(Date.now() - t0 < 1500, 'a third party that never answers cannot hold the caller');

// ---- what xConfig says after a check
const at = '2026-10-11T12:00:00.000Z';
const first = nextPublicIP({}, { ok: true, ip: '34.28.109.244' }, at);
assert.deepEqual(first, { publicIP: '34.28.109.244', publicIPDetection: { state: 'detected', observedAt: at, checkedAt: at, source: 'api.ipify.org' } });
const later = '2026-10-12T12:00:00.000Z';
const failed = nextPublicIP(first, { ok: false, error: 'no answer within 3000 ms' }, later);
assert.equal(failed.publicIP, '34.28.109.244', 'a failed check keeps the last known address');
assert.equal(failed.publicIPDetection.state, 'failed');
assert.equal(failed.publicIPDetection.observedAt, at, 'and dates it by when it was actually observed');
assert.equal(failed.publicIPDetection.checkedAt, later);
assert.equal(failed.publicIPDetection.error, 'no answer within 3000 ms');
const nothing = nextPublicIP({}, { ok: false, error: 'HTTP 500' }, at);
assert.equal(nothing.publicIP, '', 'nothing known, nothing invented');
assert.equal(nothing.publicIPDetection.observedAt, null);
assert.equal(nextPublicIP({ publicIP: 'Not available' }, { ok: false, error: 'x' }, at).publicIP, '', 'a sentinel string is not a last known address');

// ---- the shared entry point: never throws, writes only what it should
const store: any = { publicIP: '', localIP: '', publicIPDetection: null, mainServerName: 'netget.site' };
const saved: any[] = [];
const ctx = (detect: () => Promise<any>, local: string | null = '10.128.0.13', when = at) => ({
  load: async () => ({ ...store }),
  save: async (u: any) => { saved.push(u); Object.assign(store, u); },
  detect, getLocal: () => local, now: () => new Date(when),
});
let r = await ensureNetworkIdentity(ctx(async () => ({ ok: true, ip: '34.28.109.244' })));
assert.equal(r.changed, true);
assert.equal(store.publicIP, '34.28.109.244');
assert.equal(store.localIP, '10.128.0.13');
assert.equal(store.publicIPDetection.state, 'detected');
assert.equal(store.mainServerName, 'netget.site', 'only the address fields are written');
assert.deepEqual(Object.keys(saved[0]).sort(), ['localIP', 'publicIP', 'publicIPDetection']);

r = await ensureNetworkIdentity(ctx(async () => ({ ok: false, error: 'no answer within 3000 ms' }), '10.128.0.13', later));
assert.equal(r.changed, false, 'a failed check changes no address');
assert.equal(store.publicIP, '34.28.109.244');
assert.equal(store.publicIPDetection.state, 'failed');
assert.equal(store.publicIPDetection.observedAt, at);

r = await ensureNetworkIdentity(ctx(async () => { throw new Error('boom'); }, null));
assert.equal(store.publicIP, '34.28.109.244', 'a detector that throws is a failed check, not an exception');
assert.equal(store.localIP, '10.128.0.13', 'no local address found keeps the previous one');
assert.equal(store.publicIPDetection.state, 'failed');

r = await ensureNetworkIdentity(ctx(async () => ({ ok: true, ip: '34.28.109.245' })));
assert.equal(r.changed, true);
assert.equal(r.previousPublicIP, '34.28.109.244');
assert.equal(store.publicIPDetection.state, 'detected', 'recovers on the next successful check');

// ---- how the address is described: only what is known
assert.equal(describePublicAddress({ publicIP: '34.28.109.244', publicIPDetection: { state: 'detected', observedAt: at, checkedAt: at, source: 's' } }).text, '34.28.109.244 (observed 2026-10-11)');
assert.match(describePublicAddress({ publicIP: '34.28.109.244', publicIPDetection: { state: 'failed', observedAt: at, checkedAt: later, source: 's', error: 'HTTP 503' } }).text, /last known, observed 2026-10-11; the latest check failed: HTTP 503/);
assert.equal(describePublicAddress({ publicIP: '', publicIPDetection: null }).text, 'not detected yet');
assert.match(describePublicAddress({ publicIP: '', publicIPDetection: { state: 'failed', observedAt: null, checkedAt: at, source: 's', error: 'HTTP 500' } }).text, /^not detected \(the check failed: HTTP 500\)$/);
assert.equal(describePublicAddress({ publicIP: '1.2.3.4', publicIPDetection: null }).state, 'unknown');
assert.ok(!/online|reachable|accessible/i.test(describePublicAddress({ publicIP: '34.28.109.244', publicIPDetection: null }).text), 'no claim about reachability');

// ---- /ip-info: read-only, and the private address does not leave on a public answer (needs resty; skipped without it)
const resty = ['/usr/local/openresty/bin/resty', '/opt/homebrew/bin/resty', '/usr/local/bin/resty'].find((p) => fs.existsSync(p));
if (!resty) {
  console.log('network-identity: ok (ip-info handler cases skipped: no resty on this machine; run on the gateway host)');
} else {
  const harness = path.resolve('tests/lua/ip_info_harness.lua');
  const misc = path.resolve('src/modules/NetGetX/OpenResty/lua/handlers/misc.lua');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipinfo-'));
  const run = (remote: string, xconfig: object | null) => {
    if (xconfig) fs.writeFileSync(path.join(dir, 'xConfig.json'), JSON.stringify(xconfig)); else fs.rmSync(path.join(dir, 'xConfig.json'), { force: true });
    const out = spawnSync(resty, [harness, remote, misc], { env: { ...process.env, NETGET_DATA_DIR: dir }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout.trim().split('\n').pop() as string);
  };
  const detection = { state: 'detected', observedAt: at, checkedAt: at, source: 'api.ipify.org', error: undefined, internal: 'must not leave' };
  const cfg = { publicIP: '34.28.109.244', localIP: '10.128.0.13', publicIPDetection: detection };
  const pub = run('203.0.113.7', cfg);
  assert.equal(pub.publicIP, '34.28.109.244');
  assert.equal('localIP' in pub, false, 'the private address is omitted for a peer from the internet');
  assert.deepEqual(Object.keys(pub.publicIPDetection).sort(), ['checkedAt', 'observedAt', 'source', 'state'], 'only the status fields leave');
  const lan = run('10.128.0.99', cfg);
  assert.equal(lan.localIP, '10.128.0.13', 'a peer on this LAN still gets it');
  assert.equal(run('127.0.0.1', cfg).localIP, '10.128.0.13');
  const bare = run('203.0.113.7', { publicIP: 'Not available', localIP: 'x' });
  assert.equal(bare.publicIP, '', 'a sentinel string is never forwarded as an address');
  assert.equal('localIP' in bare, false);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('network-identity: ok (including the /ip-info handler)');
}
