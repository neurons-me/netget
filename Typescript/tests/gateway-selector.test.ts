import assert from 'node:assert/strict';
import {
  LOCAL_ID, normalizeGatewayAddress, loadGateways, addGateway, removeGateway, selectedGatewayId, selectGateway,
  sessionFor, saveSession, gatewayRequest, scopeKey,
} from '../src/htmls/Netget-REACT/frontend_local/src/utils/gateways.js';
import { probeGateway } from '../src/htmls/Netget-REACT/frontend_local/src/utils/gatewayProbe.js';

// The gateway selector's model: the gateways the panel can look at (this one, and the ones added by an explicit
// address), the session of EACH, and what a probe says about reading and modifying. Storage and fetch are injected.
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), _m: m }; };

// ── addresses ────────────────────────────────────────────────────────────────
const ok = (s: string) => { const r = normalizeGatewayAddress(s); assert.ok(r.ok, `${s}: ${(r as any).reason}`); return r as any; };
const no = (s: string, re: RegExp) => { const r = normalizeGatewayAddress(s); assert.equal(r.ok, false, `${s} refused`); assert.match((r as any).reason, re); };
assert.equal(ok('netget.site').origin, 'https://netget.site', 'a public name is https');
assert.equal(ok('https://netget.site/').origin, 'https://netget.site');
assert.equal(ok('raspberrypi.local:3000').origin, 'http://raspberrypi.local:3000', 'a .local name has no certificate: http');
assert.equal(ok('192.168.1.40').origin, 'http://192.168.1.40');
assert.equal(ok('localhost:5173').origin, 'http://localhost:5173');
assert.equal(ok('HTTPS://NetGet.Site').origin, 'https://netget.site');
no('', /Escribe/);
no('ftp://netget.site', /http o https/);
no('https://user:pw@netget.site', /usuario/);
no('https://netget.site/domains', /sin ruta/);
no('https://netget.site?x=1', /sin ruta/);
no('https://', /válida|host/);

// ── the list, the selection, the sessions ───────────────────────────────────
const s = memory();
const PAGE = 'http://127.0.0.1:5199';
assert.deepEqual(loadGateways(s, PAGE).map((g) => g.id), [LOCAL_ID], 'only this netget to begin with: nothing is discovered');
assert.equal(selectedGatewayId(s, PAGE), LOCAL_ID);
const added = addGateway(s, 'netget.site', '', PAGE) as any;
assert.ok(added.ok); assert.equal(added.gateway.origin, 'https://netget.site');
assert.equal((addGateway(s, 'https://netget.site', '', PAGE) as any).ok, false, 'no duplicates');
assert.equal((addGateway(s, PAGE, '', PAGE) as any).ok, false, 'this netget is not added as another one');
assert.equal((addGateway(s, 'raspberrypi.local:3000', 'Raspberry', PAGE) as any).ok, true);
const list = loadGateways(s, PAGE);
assert.deepEqual(list.map((g: any) => g.label), ['Este netget', 'netget.site', 'Raspberry']);
assert.equal(list[0].local, true); assert.equal(list[1].local, false);

selectGateway(s, 'gw-netget-site');
assert.equal(selectedGatewayId(s, PAGE), 'gw-netget-site');
selectGateway(s, LOCAL_ID);
assert.equal(selectedGatewayId(s, PAGE), LOCAL_ID);
s.setItem('netget:gateway-selected', 'gw-gone');
assert.equal(selectedGatewayId(s, PAGE), LOCAL_ID, 'a selection that no longer exists falls back to this netget');

const [local, site, rpi] = loadGateways(s, PAGE) as any[];
saveSession(s, local, 'LOCAL-TOKEN');
saveSession(s, site, 'SITE-TOKEN');
assert.equal(sessionFor(s, local), 'LOCAL-TOKEN');
assert.equal(sessionFor(s, site), 'SITE-TOKEN');
assert.equal(sessionFor(s, rpi), null, 'a session belongs to one gateway');
assert.equal(s.getItem('netget:admin-session-token'), 'LOCAL-TOKEN', 'this netget keeps using the key the rest of the panel uses');
assert.equal(removeGateway(s, LOCAL_ID).ok, false, 'this netget is not removable');
assert.equal(removeGateway(s, 'gw-netget-site').ok, true);
assert.equal(s._m.has('netget:admin-session-token:https://netget.site'), false, 'its session goes with it');

// ── requests: a gateway gets its own session and only its own ────────────────
const r1 = gatewayRequest(local, '/domains', { method: 'GET' }, 'LOCAL-TOKEN');
assert.equal(r1.url, '/domains'); assert.equal(r1.init.headers.Authorization, 'Bearer LOCAL-TOKEN');
const r2 = gatewayRequest(rpi, '/domains', { method: 'GET' }, null);
assert.equal(r2.url, 'http://raspberrypi.local:3000/domains'); assert.equal(r2.init.headers.Authorization, undefined);

// ── probes ───────────────────────────────────────────────────────────────────
type Call = { url: string; method: string; auth: string | null; body: string | null };
function fakeFetch(handler: (url: string, init: any) => { status: number; json?: any } | 'throw', calls: Call[]) {
  return async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null, body: init.body ?? null });
    const r = handler(url, init);
    if (r === 'throw') throw new TypeError('Failed to fetch');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => (r.json !== undefined ? 'application/json' : '') }, json: async () => r.json };
  };
}
const PUBLIC = (url: string) => /gateway-identity$/.test(url) ? { status: 200, json: { gatewayId: 'g1', hostname: 'netget', owner: 'o', bootstrapped: true } }
  : /healthcheck$/.test(url) ? { status: 200, json: { status: 'ok', version: '2.56' } }
  : /main-server-namespace$/.test(url) ? { status: 200, json: { namespace: 'cleaker.me', mainServerName: 'netget.site' } }
  : /\/domains$/.test(url) ? { status: 200, json: { success: true, domains: [{ domain: 'netget.site', type: 'main_server', tlsConfigured: true }] } } : { status: 404 };

// without a session: public reads, no write, and NOTHING is sent that could change anything
{
  const calls: Call[] = [];
  const rep = await probeGateway(site, { token: null, fetchImpl: fakeFetch((u) => PUBLIC(u), calls) as any });
  assert.equal(rep.reachable, true);
  assert.equal(rep.identity.gatewayId, 'g1'); assert.equal(rep.version, '2.56'); assert.equal(rep.mainServerName, 'netget.site');
  assert.equal(rep.domains.length, 1);
  assert.deepEqual(rep.reads.map((r: any) => r.state), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(rep.permissions.modify.state, 'no'); assert.equal(rep.permissions.hasSession, false);
  assert.ok(calls.every((c) => c.method === 'GET' && c.auth === null), 'only GETs, no credential');
  assert.ok(calls.every((c) => c.url.startsWith('https://netget.site/')), 'only that gateway');
}

// a session: the capability is asked with an EMPTY request; its answer decides
for (const [status, want] of [[400, 'yes'], [403, 'no'], [401, 'no'], [500, 'unknown']] as const) {
  const calls: Call[] = [];
  const rep = await probeGateway(rpi, { token: 'RPI-TOKEN', fetchImpl: fakeFetch((u, init) => (init.method === 'POST' ? { status, json: { error: 'x' } } : PUBLIC(u)), calls) as any });
  assert.equal(rep.permissions.modify.state, want, `capability ${status}`);
  const post = calls.find((c) => c.method === 'POST')!;
  assert.equal(post.url, 'http://raspberrypi.local:3000/add-domain');
  assert.equal(post.body, '{}', 'an empty request: no domain name is ever sent');
  assert.equal(post.auth, 'Bearer RPI-TOKEN');
  assert.ok(calls.every((c) => c.url.startsWith('http://raspberrypi.local:3000/')), 'the session went only to its gateway');
}
{
  const calls: Call[] = [];
  const rep = await probeGateway(rpi, { token: 'T', fetchImpl: fakeFetch((u, init) => init.method === 'POST' ? { status: 400, json: {} } : /\/domains$/.test(u) && init.headers?.Authorization ? { status: 200, json: { domains: [{ domain: 'a.test', target: '127.0.0.1:4000' }] } } : PUBLIC(u), calls) as any });
  assert.equal(rep.permissions.readConfig.state, 'yes', 'with the session /domains carries targets');
}

// unreachable is "unknown", not "down"; a refusal is a refusal
{
  const rep = await probeGateway(site, { token: null, fetchImpl: fakeFetch(() => 'throw', []) as any });
  assert.equal(rep.reachable, 'unknown');
  assert.ok(rep.reads.every((r: any) => r.state === 'unreachable' && /CORS/.test(r.detail)));
  const rep2 = await probeGateway(site, { token: null, fetchImpl: fakeFetch((u) => /\/domains$/.test(u) ? { status: 403, json: {} } : PUBLIC(u), []) as any });
  assert.equal(rep2.reads.find((r: any) => r.path === '/domains').state, 'refused');
  assert.equal(rep2.reachable, true);
  const rep3 = await probeGateway(site, { token: 'T', fetchImpl: fakeFetch((u, init) => init.method === 'POST' ? 'throw' : PUBLIC(u), []) as any });
  assert.equal(rep3.permissions.modify.state, 'unknown');
}

// the scope an asynchronous answer is applied under: the gateway AND the session it was asked with. A late answer for
// another gateway, or for the same gateway under another session, has a different key and is dropped by the panel.
{
  const a = { id: 'local' }; const b = { id: 'gw-netget-site' };
  assert.equal(scopeKey(a, 'T'), scopeKey({ id: 'local' }, 'T'), 'the same gateway and session is the same scope');
  assert.notEqual(scopeKey(a, 'T'), scopeKey(b, 'T'), 'another gateway is another scope');
  assert.notEqual(scopeKey(a, 'T'), scopeKey(a, 'U'), 'another session on the same gateway is another scope');
  assert.notEqual(scopeKey(a, null), scopeKey(a, 'T'), 'signing in or out changes the scope');
  assert.equal(scopeKey(a, null), scopeKey(a, ''), 'no session is one scope');
  assert.notEqual(scopeKey(undefined, null), scopeKey(a, null));
}

console.log('gateway-selector: ok');
