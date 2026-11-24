import assert from 'node:assert/strict';

// ONE entry for every door. The page mounts the same shell (`<Cleaker>`) at cleaker.me, at www and handles, at
// netget.site and at localhost; what it renders depends on where you are in the tree, never a second app chosen by the
// hostname. This test pins:
//
//   * namespace / transport come from what the monad (boot) or the gateway (/main-server-namespace) declared;
//     the address bar is only a draft when nothing declared them
//   * the door never decides access: resolveEntry only says which namespace and where the entrance is
//   * NETGET_DOCUMENT is the gateway branch at /netget; App.jsx offers it to the owner (gateway:admin) at that pointer,
//     and the visitor sees the namespace itself (Storybook example 1), on every door
//   * what netget offers on that branch, and what each part NEEDS from the selected link (Domains `gateway:admin`;
//     Logs `gateway:logs`). Signing in is not what unlocks them, and neither is the door.
//     The resolvers are covered by gateway-capabilities.test.ts; offerGatewayDocument is covered below; the server still authorizes every request.
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
  assert.equal(e.brand, null, `${host}: the page IS the namespace, so no app brand (netget's) over it`);
  assert.equal('hideBarItems' in e, false, `${host}: the namespace door does not carry netget rail policy`);
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
  assert.equal(e.brand, 'netget', "netget.site is netget's app: its brand");
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

// ── NETGET_DOCUMENT is the /netget branch; resolveEntry itself never carries a document ───────────────────────────
const leftIds = (doc: any) => Object.keys(doc.GUI.children.bars.children.left.children);
const contentIds = (doc: any) => Object.keys(doc.GUI.children.content.children);
const left = (id: string) => NETGET_DOCUMENT.GUI.children.bars.children.left.children[id];
const content = (id: string) => NETGET_DOCUMENT.GUI.children.content.children[id];

assert.deepEqual(leftIds(NETGET_DOCUMENT), ['dashboard', 'domains', 'logs']);
assert.deepEqual(contentIds(NETGET_DOCUMENT).sort(), ['apps', 'dashboard', 'domains', 'logs', 'monad', 'privacy', 'terms']);
assert.equal(typeof (entryModule as any).netgetDocumentFor, 'undefined', 'there is no document picker on resolveEntry');
assert.equal(ENTRY_KINDS.includes('namespace') && ENTRY_KINDS.includes('gateway'), true);
assert.equal('document' in resolveEntry({ host: 'localhost', boot: null, declared: null, pathname: '/' }), false, 'the resolved entry carries no document');
assert.equal('document' in resolveEntry({ host: 'cleaker.me', boot: bothBoot, declared: null, pathname: '/' }), false, 'a namespace door also carries no document');

// What netget offers on a gateway door, and what each part NEEDS, is declared on the part
assert.equal(content('monad').needs, 'monad', 'the shell dims /monad when the monad behind the link is off');
assert.equal(left('dashboard').requires, undefined, 'dashboard is public information');
assert.deepEqual(left('domains').requires, { capability: 'gateway:admin' }, 'Domains: the selected gateway recognizes who is signed in as an administrator');
assert.deepEqual(content('domains').requires, left('domains').requires, 'the page behind /domains asks for what its link asks for');
assert.deepEqual(left('logs').requires, { capability: 'gateway:logs' }, 'Logs: the explicit logs-read grant, not "administrator"');
assert.deepEqual(content('logs').requires, left('logs').requires);
assert.notEqual(left('domains').requires.capability, left('logs').requires.capability, 'different permissions are different capabilities');
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
assert.ok(/resolveEntry\(/.test(app), 'the one entry is resolved, then mounted');
assert.ok(/offerDocument/.test(app) && /offerGatewayDocument/.test(app), 'the document is offered by pointer and who you are, not by door kind');
assert.ok(!/namespaceDoor/.test(app) && !/entry\.kind === 'namespace'/.test(app), 'the door kind does not decide whether the document is passed');
assert.ok(/document=\{NETGET_DOCUMENT\}/.test(app), 'NETGET_DOCUMENT is given to Cleaker; offering it is offerDocument');
assert.ok(/pages=\{NETGET_PAGES\}/.test(app), 'netget pages are given to Cleaker; offering them follows the document');
assert.ok(/hideBarItems=\{entry.hideBarItems\}/.test(app), 'rail policy is whatever the entry carries, offered with the document');
assert.ok(/capabilities=\{GATEWAY_RESOLVERS\}/.test(app), 'gateway resolvers reach the shell; offering follows the document');
assert.ok(/mapRootToNetget=\{offered\}/.test(app), 'the main-server URL map (/=/netget) is only on for an owner, so a visitor at netget.site sees the namespace');
assert.ok(!/const NETGET_DOCUMENT\b/.test(app), 'the document is not redeclared in App.jsx');

// Pointer + who you are: offerGatewayDocument (the check Cleaker runs inside the session)
import { atGatewayPointer, offerGatewayDocument, GATEWAY_BRANCH_ROUTES } from '../src/htmls/Netget-REACT/frontend_local/src/session/offerGatewayDocument.js';

const nsEntry = resolveEntry({ host: 'cleaker.me', boot: bothBoot, declared: declaredMain, pathname: '/' });
const handleEntry = resolveEntry({ host: 'jabellae.cleaker.me', boot: handleBoot, declared: declaredMain, pathname: '/' });
const mainEntry = resolveEntry({ host: 'netget.site', boot: null, declared: declaredMain, pathname: '/' });
assert.equal(atGatewayPointer({ entry: nsEntry, pathname: '/' }), false, 'the namespace root is not the /netget pointer');
assert.equal(atGatewayPointer({ entry: handleEntry, pathname: '/' }), false, 'a handle root is not the /netget pointer');
assert.equal(atGatewayPointer({ entry: handleEntry, pathname: '/netget' }), true, 'a handle at /netget is the pointer');
assert.equal(atGatewayPointer({ entry: nsEntry, pathname: '/domains' }), true, 'Domains is on the gateway branch');
assert.equal(atGatewayPointer({ entry: mainEntry, pathname: '/' }), true, 'netget.site enters at /netget, including at /');
assert.ok(GATEWAY_BRANCH_ROUTES.includes('/netget') && GATEWAY_BRANCH_ROUTES.includes('/domains'));

const ownerResolvers = { 'gateway:admin': async () => true };
const visitorResolvers = { 'gateway:admin': async () => false };
assert.equal(await offerGatewayDocument({ session: { authenticated: true }, entry: mainEntry, pathname: '/', resolvers: ownerResolvers }), true, 'the owner on netget.site is offered the document');
assert.equal(await offerGatewayDocument({ session: { authenticated: false }, entry: mainEntry, pathname: '/', resolvers: visitorResolvers }), false, 'the visitor on netget.site is not offered the document');
assert.equal(await offerGatewayDocument({ session: { authenticated: true }, entry: handleEntry, pathname: '/', resolvers: ownerResolvers }), false, 'the owner at a handle root is not offered the document (that is the namespace itself)');
assert.equal(await offerGatewayDocument({ session: { authenticated: true }, entry: handleEntry, pathname: '/netget', resolvers: ownerResolvers }), true, 'the owner at a handle /netget is offered the document');
assert.equal(await offerGatewayDocument({ session: { authenticated: false }, entry: nsEntry, pathname: '/netget', resolvers: visitorResolvers }), false, 'the visitor at /netget is not offered the document');
assert.equal(await offerGatewayDocument({ session: { authenticated: true }, entry: nsEntry, pathname: '/netget', resolvers: { 'gateway:admin': async () => { throw new Error('no'); } } }), false, 'a failed check fails closed');

console.log('entry-composition: ok');
