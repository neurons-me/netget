import assert from 'node:assert/strict';

// ONE entry for every door. The page mounts the same shell (`<Cleaker>`) with the SAME document at cleaker.me, at www and handles, at
// netget.site and at localhost; what differs is the CONTEXT that was resolved, never a second app (or a second document) chosen by the
// hostname. This test pins:
//
//   * namespace / transport come from what the monad (boot) or the gateway (/main-server-namespace) declared;
//     the address bar is only a draft when nothing declared them
//   * how a door presents itself (rail icons left out, the node its position label points at)
//   * the one document: what the app offers is the same everywhere, and each part declares what it NEEDS from the selected
//     link (Monad nothing; Domains `gateway:admin`; Logs `gateway:logs`). Signing in is not what unlocks them, and neither is the door.
//     The resolvers are covered by gateway-capabilities.test.ts; the server still authorizes every request.
//
// (frontendRole itself is unchanged and covered by frontend-provider-boot.test.ts.)
const entryModule = await import('../src/htmls/Netget-REACT/frontend_local/src/session/entryContext.js');
const { resolveEntry, needsDeclaration, NETGET_DOCUMENT, ENTRY_KINDS } = entryModule;

const namespaceBoot = { namespace: 'cleaker.me', modules: [] };
const bothBoot = { namespace: 'cleaker.me', modules: ['netget/gateway'] };
const handleBoot = { namespace: 'jabellae.cleaker.me', rootNamespace: 'cleaker.me', modules: ['netget/gateway'], handle: 'jabellae' };
const declaredMain = { namespace: 'cleaker.me', mainServerName: 'netget.site' };

assert.deepEqual([...ENTRY_KINDS].sort(), ['gateway', 'host', 'namespace']);

// ── the namespace's own doors: cleaker.me, www, a handle ───────────────────────────────────────────────────────────
for (const [host, boot] of [['cleaker.me', bothBoot], ['www.cleaker.me', bothBoot], ['cleaker.me', namespaceBoot], ['jabellae.cleaker.me', handleBoot]] as const) {
  const e = resolveEntry({ host, boot, declared: declaredMain, pathname: '/' });
  assert.equal(e.kind, 'namespace', `${host}: a namespace door`);
  assert.equal(e.namespace, 'cleaker.me', `${host}: the link goes to the ROOT namespace, never to the address bar or a handle`);
  assert.equal(e.namespaceSource, 'declared', `${host}: the monad said so`);
  assert.equal(e.isMainServerDoor, false, `${host}: not the main server's door`);
  assert.equal(e.canonicalPath, null);
  assert.equal(e.semanticPath, '/');
  assert.equal(needsDeclaration({ host, boot }), false, `${host}: nothing to wait for, the monad already declared the namespace`);
}

// ── the gateway's doors: netget.site (declared main server), localhost, anything nginx serves statically ──────────────
{
  const e = resolveEntry({ host: 'netget.site', boot: null, declared: declaredMain, pathname: '/' });
  assert.equal(e.kind, 'gateway');
  assert.equal(e.isMainServerDoor, true);
  assert.equal(e.namespace, 'cleaker.me', 'the main server door links to the DECLARED namespace');
  assert.equal(e.namespaceSource, 'declared');
  assert.equal(e.semanticPath, '/netget');
  assert.deepEqual(e.hideBarItems, ['users', 'blockchain', 'url', 'dashboard']);
  assert.equal(needsDeclaration({ host: 'netget.site', boot: null }), true, 'nginx-served: it must ask the gateway which door this is');
  assert.equal(resolveEntry({ host: 'netget.site', boot: null, declared: declaredMain, pathname: '/netget' }).canonicalPath, '/', 'an old /netget link moves to /');
}
for (const declared of [null, { namespace: 'localhost', mainServerName: null }]) {
  const e = resolveEntry({ host: 'localhost', boot: null, declared, pathname: '/' });
  assert.equal(e.kind, 'gateway');
  assert.equal(e.isMainServerDoor, false);
  assert.equal(e.namespace, 'localhost', 'no declaration: the host is a draft of the namespace');
  assert.equal(e.namespaceSource, 'address', '...and the shell says so (it signs and claims nothing meanwhile)');
  assert.equal(e.semanticPath, '/');
  assert.deepEqual(e.hideBarItems, ['url', 'dashboard']);
}

// ── the separate host surface is not a composition of this app ─────────────────────────────────────────────────────────
assert.equal(resolveEntry({ host: 'local.host', boot: null, declared: null, pathname: '/' }).kind, 'host');

// ── a door never decides the namespace by itself ───────────────────────────────────────────────────────────────────────
{
  const viaBoot = resolveEntry({ host: 'cleaker.me', boot: bothBoot, declared: null, pathname: '/' });
  const viaBootAndDeclared = resolveEntry({ host: 'cleaker.me', boot: bothBoot, declared: declaredMain, pathname: '/' });
  assert.deepEqual(viaBoot, viaBootAndDeclared, 'what the gateway declares does not change what the monad already said');
}

// ── ONE document, whatever the door ────────────────────────────────────────────────────────────────────────────────
const leftIds = (doc: any) => Object.keys(doc.GUI.children.bars.children.left.children);
const contentIds = (doc: any) => Object.keys(doc.GUI.children.content.children);
const left = (id: string) => NETGET_DOCUMENT.GUI.children.bars.children.left.children[id];
const content = (id: string) => NETGET_DOCUMENT.GUI.children.content.children[id];

assert.deepEqual(leftIds(NETGET_DOCUMENT), ['dashboard', 'domains', 'logs', 'monad']);
assert.deepEqual(contentIds(NETGET_DOCUMENT).sort(), ['apps', 'dashboard', 'domains', 'logs', 'monad', 'privacy', 'terms']);
assert.equal(typeof (entryModule as any).netgetDocumentFor, 'undefined', 'there is no document per kind of door any more');
assert.equal(ENTRY_KINDS.includes('namespace') && ENTRY_KINDS.includes('gateway'), true);
for (const kind of ['namespace', 'gateway']) assert.equal('document' in resolveEntry({ host: 'localhost', boot: null, declared: null, pathname: '/' }), false, `${kind}: the resolved entry carries no document`);

// What the app offers is the same everywhere; what each part NEEDS is declared on the part, from the selected link
assert.equal(left('monad').requires, undefined, 'Monad needs nothing from the link');
assert.equal(left('monad').icon, 'orb:monad');
assert.equal(content('monad').needs, 'monad', 'the shell dims it when the monad behind the link is off');
assert.deepEqual(left('domains').requires, { capability: 'gateway:admin' }, 'Domains: the selected gateway recognizes who is signed in as an administrator');
assert.deepEqual(content('domains').requires, left('domains').requires, 'the page behind /domains asks for what its link asks for');
assert.deepEqual(left('logs').requires, { capability: 'gateway:logs' }, 'Logs: the explicit logs-read grant, not "administrator"');
assert.deepEqual(content('logs').requires, left('logs').requires);
assert.notEqual(left('domains').requires.capability, left('logs').requires.capability, 'different permissions are different capabilities');
for (const id of ['dashboard', 'monad']) assert.equal(left(id).requires, undefined, `${id} is public information`);
// a session is no longer what unlocks them
for (const id of ['domains', 'logs']) assert.notEqual(left(id).requires, 'session', `${id}: signing in is not enough`);
assert.equal(content('domains').needs, 'both');
assert.equal(content('logs').needs, 'backend');

// stable and frozen: the shell memoizes on the document object
assert.throws(() => { (NETGET_DOCUMENT as any).GUI.children.bars.children.left.children.extra = {}; }, TypeError, 'the document is frozen');

// ── App.jsx composes ONE entry: no second app chosen by the hostname ───────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
const app = fs.readFileSync(path.resolve('src/htmls/Netget-REACT/frontend_local/src/App.jsx'), 'utf8');
assert.equal((app.match(/<Cleaker\b/g) || []).length, 1, 'one shell, mounted once');
assert.ok(!/<Namespace\b/.test(app), 'the bare Namespace landing is not mounted by this app any more');
assert.ok(!/ROLE\s*===\s*['"](cleaker|gateway)['"]/.test(app), 'no branch between a "cleaker" app and a "gateway" app');
assert.ok(/resolveEntry\(/.test(app) && /document=\{NETGET_DOCUMENT\}/.test(app), 'the one document is mounted whatever the door');
assert.ok(/capabilities=\{GATEWAY_RESOLVERS\}/.test(app) && /capabilityScope=\{gatewayScope\}/.test(app), 'the resolvers and the selected gateway\'s scope reach the shell');
assert.ok(!/const NETGET_DOCUMENT\b/.test(app), 'the document is not a constant declared for one door');

console.log('entry-composition: ok');
