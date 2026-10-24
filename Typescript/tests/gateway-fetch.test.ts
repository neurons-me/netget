import assert from 'node:assert/strict';

// A request to the SELECTED gateway carries that gateway's credentials, and only that gateway's: this netget is asked with the
// signed proof of the identity signed in through the selected link; a gateway that was added is asked with its own admin session.
const FE = '../src/htmls/Netget-REACT/frontend_local/src';
const { gatewayFetch } = await import(`${FE}/utils/gatewayFetch.js`);
const { LOCAL_ID, addGateway, loadGateways, saveSession, sessionFor } = await import(`${FE}/utils/gateways.js`);

const storage = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k) }; })();
const PAGE = 'https://gw.test';
const added = addGateway(storage, 'https://other.test', 'Other', PAGE) as any;
const gateways = loadGateways(storage, PAGE);
const local = gateways.find((g: any) => g.id === LOCAL_ID);
const other = gateways.find((g: any) => g.id === added.gateway.id);
saveSession(storage, local, 'token-of-local');
saveSession(storage, other, 'token-of-other');

const log: any[] = [];
const fetchImpl = async (url: string, init: any) => { log.push({ kind: 'fetch', url, auth: init?.headers?.Authorization ?? null }); return { ok: true, status: 200 } as any; };
const signedRequest = async (node: any, hostname: string, path: string, init: any) => { log.push({ kind: 'signed', node: node.id, hostname, path, method: init?.method ?? 'GET' }); return { ok: true, status: 200 } as any; };
const sess = { node: { id: 'node-of-ana' }, hostname: 'host.test' };
const run = (gateway: any, session: any, path = '/logs?type=access', init: any = {}) => {
  log.length = 0;
  return gatewayFetch({ gateway, token: sessionFor(storage, gateway), session, signedRequest, fetchImpl }, path, init).then(() => log.slice());
};

// this netget + an identity signed in through the selected link: the proof signs the request (what nginx's /logs and /check-auth ask for)
assert.deepEqual(await run(local, sess), [{ kind: 'signed', node: 'node-of-ana', hostname: 'host.test', path: '/logs?type=access', method: 'GET' }], 'signed; the stored token is not sent when the proof is');
// this netget, no identity: its own admin session, if one is stored
assert.deepEqual(await run(local, null), [{ kind: 'fetch', url: '/logs?type=access', auth: 'Bearer token-of-local' }]);
// a gateway that was added: ITS token, at ITS origin, and never the shell's identity (a proof is made for one gateway's hostname)
assert.deepEqual(await run(other, sess), [{ kind: 'fetch', url: 'https://other.test/logs?type=access', auth: 'Bearer token-of-other' }]);
// no credentials at all: plain, and the gateway refuses it
saveSession(storage, local, '');
assert.deepEqual(await run(local, null), [{ kind: 'fetch', url: '/logs?type=access', auth: null }]);
// a gateway without a session of its own is not lent another's
saveSession(storage, other, '');
assert.deepEqual(await run(other, sess), [{ kind: 'fetch', url: 'https://other.test/logs?type=access', auth: null }]);
// the init the caller gave is kept
saveSession(storage, local, 'token-of-local');
const posted = await run(local, null, '/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
assert.equal(posted[0].auth, 'Bearer token-of-local');

console.log('gateway-fetch: ok');
