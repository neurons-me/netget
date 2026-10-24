import assert from 'node:assert/strict';

// What netget's document asks of the SELECTED gateway, and how that is answered. The shell (this.gui) calls one resolver per
// capability with the selected link, the session through it, and the app's scope; the scope is "which gateway is selected,
// and which admin session is stored for it". Resolvers only answer "should this be offered": the gateway authorizes every
// request. Nothing here reaches the network: the four dependencies are injected.
const FE = '../src/htmls/Netget-REACT/frontend_local/src';
const { createGatewayResolvers, gatewayScope, GATEWAY_ADMIN, GATEWAY_LOGS, LOGS_READ_SCOPE } = await import(`${FE}/session/gatewayCapabilities.js`);
const { LOCAL_ID, addGateway, saveSession, selectGateway, removeGateway } = await import(`${FE}/utils/gateways.js`);
const { classifyModifyStatus } = await import(`${FE}/utils/gatewayProbe.js`);

const memoryStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k) };
};
const PAGE = 'https://gw.test';
const meOf = (name: string) => ({ name });
const session = (name: string | null) => ({ authenticated: name !== null, identityHash: name ? `${name}-hash` : null, me: name ? meOf(name) : null });
const link = { id: 'ns@https://gw.test', namespace: 'ns', transport: 'https://gw.test' };

function setup(checkAuthFor: (me: any) => any, probe: (g: any, token: string) => string = () => 'no') {
  const calls = { signed: [] as any[], hostname: 0, probe: [] as any[] };
  const deps = {
    fetchHostname: async () => { calls.hostname += 1; return 'host.test'; },
    deriveNode: (me: any, hostname: string) => ({ me, hostname }),
    signedRequest: async (node: any, hostname: string, path: string) => {
      calls.signed.push({ me: node.me.name, hostname, path });
      const body = checkAuthFor(node.me);
      if (body instanceof Error) throw body;
      return { ok: true, status: 200, json: async () => body };
    },
    probeModify: async (gateway: any, token: string) => { calls.probe.push({ id: gateway.id, token }); return probe(gateway, token); },
  };
  const storage = memoryStorage();
  const resolvers = createGatewayResolvers({ storage, pageOrigin: PAGE, deps });
  const ask = (name: string, sessionName: string | null, scope: string, signal = new AbortController().signal) =>
    resolvers[name]({ link, session: session(sessionName), scope, signal });
  return { calls, storage, resolvers, ask };
}
const scopeOf = (storage: any) => gatewayScope(storage, PAGE);

assert.equal(GATEWAY_ADMIN, 'gateway:admin');
assert.equal(GATEWAY_LOGS, 'gateway:logs');
assert.equal(LOGS_READ_SCOPE, 'gateway:control:logs-read');
assert.deepEqual(Object.keys(createGatewayResolvers({ storage: memoryStorage(), pageOrigin: PAGE, deps: setup(() => ({})).calls as any })).sort(), [GATEWAY_ADMIN, GATEWAY_LOGS].sort());

// ── this netget: the gateway recognizes the identity signed in through the selected link ────────────────────────────────
{
  const owner = { authenticated: true, isOwner: true, isAdmin: false, scopes: [] };
  const admin = { authenticated: true, isOwner: false, isAdmin: true, scopes: [LOGS_READ_SCOPE] };
  const plain = { authenticated: true, isOwner: false, isAdmin: false, scopes: ['gateway:read'] };
  const nobody = { authenticated: false };
  const table: Record<string, any> = { owner, admin, plain, nobody };
  const t = setup((me) => table[me.name]);
  const scope = scopeOf(t.storage);
  assert.equal(await t.ask(GATEWAY_ADMIN, 'owner', scope), true, 'the owner');
  assert.equal(await t.ask(GATEWAY_ADMIN, 'admin', scope), true, 'an administrator');
  assert.equal(await t.ask(GATEWAY_ADMIN, 'plain', scope), false, 'recognized, but not an administrator');
  assert.equal(await t.ask(GATEWAY_ADMIN, 'nobody', scope), false, 'the gateway did not recognize the proof');
  assert.equal(await t.ask(GATEWAY_LOGS, 'owner', scope), false, 'logs need the explicit scope: no owner bypass (lua/handlers/logs.lua)');
  assert.equal(await t.ask(GATEWAY_LOGS, 'admin', scope), true, 'an administrator holding gateway:control:logs-read');
  assert.equal(await t.ask(GATEWAY_LOGS, 'plain', scope), false);
  assert.ok(t.calls.signed.every((c) => c.path === '/check-auth' && c.hostname === 'host.test'), 'always the same signed, per-request question');
}

// ── whoever is not signed in through the selected link is not asked about at all ─────────────────────────────────────────
{
  const t = setup(() => ({ authenticated: true, isOwner: true, scopes: [] }));
  assert.equal(await t.ask(GATEWAY_ADMIN, null, scopeOf(t.storage)), false);
  assert.equal(await t.ask(GATEWAY_LOGS, null, scopeOf(t.storage)), false);
  assert.equal(t.calls.signed.length + t.calls.hostname + t.calls.probe.length, 0, 'no network for an anonymous visitor');
}

// ── the proof is signed with the session of the SELECTED link: another identity is another answer ───────────────────────────
{
  const t = setup((me) => ({ authenticated: true, isOwner: me.name === 'ana', isAdmin: false, scopes: [] }));
  const scope = scopeOf(t.storage);
  assert.equal(await t.ask(GATEWAY_ADMIN, 'ana', scope), true);
  assert.equal(await t.ask(GATEWAY_ADMIN, 'bob', scope), false, 'ana\'s grant does not enable bob');
  assert.deepEqual(t.calls.signed.map((c) => c.me), ['ana', 'bob'], 'each answer was signed by the identity it is about');
}

// ── one question per resolution, however many capabilities it carries ───────────────────────────────────────────────────
{
  const t = setup(() => ({ authenticated: true, isOwner: true, isAdmin: true, scopes: [LOGS_READ_SCOPE] }));
  const scope = scopeOf(t.storage);
  const signal = new AbortController().signal;
  const [admin, logs] = await Promise.all([t.ask(GATEWAY_ADMIN, 'ana', scope, signal), t.ask(GATEWAY_LOGS, 'ana', scope, signal)]);
  assert.deepEqual([admin, logs], [true, true]);
  assert.equal(t.calls.signed.length, 1, 'one signed /check-auth feeds both capabilities');
  await t.ask(GATEWAY_ADMIN, 'ana', scope, new AbortController().signal);
  assert.equal(t.calls.signed.length, 2, 'a new resolution (new signal) asks again: nothing is remembered across resolutions');
}

// ── errors fail closed ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = setup(() => new Error('gateway unreachable'));
  assert.equal(await t.ask(GATEWAY_ADMIN, 'ana', scopeOf(t.storage)), false);
  assert.equal(await t.ask(GATEWAY_LOGS, 'ana', scopeOf(t.storage), new AbortController().signal), false);
}

// ── gateways the person added: each one's own admin session, asked of that gateway; never the shell's identity, never another's token ──
{
  // ana is recognized by this netget but is not an administrator there; the tokens decide
  const plain = { authenticated: true, isOwner: false, isAdmin: false, scopes: [LOGS_READ_SCOPE] };
  const t = setup(() => plain, (_g, token) => (token === 'remote-token' ? 'yes' : 'no'));
  const added = addGateway(t.storage, 'https://other.test', 'Other', PAGE);
  assert.ok(added.ok);
  const remoteId = (added as any).gateway.id;
  saveSession(t.storage, { local: true }, 'local-token');                       // this netget does not accept it
  saveSession(t.storage, { local: false, origin: 'https://other.test' }, 'remote-token');

  selectGateway(t.storage, remoteId);
  let scope = scopeOf(t.storage);
  assert.equal(await t.ask(GATEWAY_ADMIN, 'ana', scope), true, 'the console is offered: the selected gateway accepts the session stored for it');
  assert.deepEqual(t.calls.probe, [{ id: LOCAL_ID, token: 'local-token' }, { id: remoteId, token: 'remote-token' }], 'every gateway was asked with ITS OWN session, and nobody else\'s');
  assert.equal(await t.ask(GATEWAY_LOGS, 'ana', scope, new AbortController().signal), false, 'logs are read with this machine\'s own proof: a selected gateway that was added does not offer them, whatever the shell\'s identity may do here');

  // selecting a gateway that holds no session of its own does not hide the console that selects (it would leave no way back)
  const third = addGateway(t.storage, 'https://third.test', 'Third', PAGE) as any;
  selectGateway(t.storage, third.gateway.id);
  scope = scopeOf(t.storage);
  assert.equal(await t.ask(GATEWAY_ADMIN, 'ana', scope, new AbortController().signal), true, 'still offered: a gateway in the list accepts a stored session');

  // nothing stored anywhere accepts anything: not offered, and nobody was asked with a session that does not exist
  const none = setup(() => plain, () => 'no');
  const other = addGateway(none.storage, 'https://other.test', 'Other', PAGE) as any;
  selectGateway(none.storage, other.gateway.id);
  assert.equal(await none.ask(GATEWAY_ADMIN, 'ana', scopeOf(none.storage)), false);
  assert.equal(none.calls.probe.length, 0, 'no session stored: nothing to ask');

  // a scope that names a gateway that is gone selects none: no logs, and the console follows what is still true
  removeGateway(t.storage, remoteId);
  assert.equal(await t.ask(GATEWAY_LOGS, 'ana', scope, new AbortController().signal), false);
}

// ── this netget with a stored admin session and nobody signed in: the same answer the Domains screen uses ─────────────────────
{
  const t = setup(() => ({ authenticated: true, isOwner: true, scopes: [] }), () => 'yes');
  saveSession(t.storage, { local: true }, 'local-token');
  assert.equal(await t.ask(GATEWAY_ADMIN, null, scopeOf(t.storage)), true);
  assert.equal(t.calls.probe[0].token, 'local-token');
  assert.equal(t.calls.signed.length, 0, 'nobody is signed in: no proof is made');
}

// ── the scope: which gateway, and which admin sessions; never a session itself ──────────────────────────────────────────────
{
  const storage = memoryStorage();
  const base = gatewayScope(storage, PAGE);
  assert.equal(gatewayScope(storage, PAGE), base, 'stable');
  saveSession(storage, { local: true }, 'secret-token-123');
  const withToken = gatewayScope(storage, PAGE);
  assert.notEqual(withToken, base, 'storing a session changes the scope (so it is asked again)');
  assert.ok(!withToken.includes('secret-token-123'), 'the token is never part of the scope');
  saveSession(storage, { local: true }, 'another-token');
  assert.notEqual(gatewayScope(storage, PAGE), withToken, 'another session, another scope');
  saveSession(storage, { local: true }, '');
  assert.equal(gatewayScope(storage, PAGE), base, 'removing it returns to the scope without one');
  const added = addGateway(storage, 'https://other.test', '', PAGE) as any;
  assert.equal(gatewayScope(storage, PAGE), base, 'adding a gateway selects nothing: the scope is the same');
  selectGateway(storage, added.gateway.id);
  assert.notEqual(gatewayScope(storage, PAGE), base, 'selecting another gateway');
  assert.ok(gatewayScope(storage, PAGE).startsWith(added.gateway.id), 'it names the selected gateway first');
  const selectedOnly = gatewayScope(storage, PAGE);
  saveSession(storage, { local: false, origin: 'https://other.test' }, 'tok');
  assert.notEqual(gatewayScope(storage, PAGE), selectedOnly, 'a session stored for a gateway changes the scope');
  selectGateway(storage, LOCAL_ID);
  assert.ok(gatewayScope(storage, PAGE).startsWith(`${LOCAL_ID}|`), 'and the local one is selected again by id');
}

// ── the existing probe and the resolver agree on what a 400/401/403 from the capability gate means ───────────────────────
assert.equal(classifyModifyStatus(400).state, 'yes');
assert.equal(classifyModifyStatus(401).state, 'no');
assert.equal(classifyModifyStatus(403).state, 'no');
assert.equal(classifyModifyStatus(0).state, 'unknown');
assert.equal(classifyModifyStatus(500).state, 'unknown');

console.log('gateway-capabilities: ok');
