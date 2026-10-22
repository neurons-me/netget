import assert from 'node:assert/strict';

// ONE entry for every door. The page mounts the same shell (`<Cleaker>`) at cleaker.me, at www and handles, at
// netget.site and at localhost; what differs is the CONTEXT that was resolved, never a second app chosen by the
// hostname. This test pins what the resolved context says and which parts of the netget document it composes:
//
//   * namespace / transport come from what the monad (boot) or the gateway (/main-server-namespace) declared;
//     the address bar is only a draft when nothing declared them
//   * Monad is part of every door's document (a monad is identified there; the shell dims it when it is off)
//   * Dashboard, Domains, Logs and Apps are the GATEWAY's screens: they are composed only where the resolved
//     context says this entry is a gateway door, and even there Domains/Logs stay `requires: 'session'` and
//     the server decides, request by request, what a session may do
//
// (frontendRole itself is unchanged and covered by frontend-provider-boot.test.ts.)
const { resolveEntry, needsDeclaration, netgetDocumentFor, ENTRY_KINDS } =
  await import('../src/htmls/Netget-REACT/frontend_local/src/session/entryContext.js');

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

// ── the document each kind composes ───────────────────────────────────────────────────────────────────────────────────
const leftIds = (doc: any) => Object.keys(doc.GUI.children.bars.children.left.children);
const contentIds = (doc: any) => Object.keys(doc.GUI.children.content.children);
const left = (doc: any, id: string) => doc.GUI.children.bars.children.left.children[id];
const content = (doc: any, id: string) => doc.GUI.children.content.children[id];

const ns = netgetDocumentFor('namespace');
const gw = netgetDocumentFor('gateway');

assert.deepEqual(leftIds(ns), ['monad'], 'a namespace door: Monad, and nothing of the gateway\'s admin screens in the rail');
assert.deepEqual(contentIds(ns).sort(), ['monad', 'privacy', 'terms']);
assert.deepEqual(leftIds(gw), ['dashboard', 'domains', 'logs', 'monad']);
assert.deepEqual(contentIds(gw).sort(), ['apps', 'dashboard', 'domains', 'logs', 'monad', 'privacy', 'terms']);

// Monad is the same declaration on every door
assert.deepEqual(left(ns, 'monad'), left(gw, 'monad'));
assert.deepEqual(content(ns, 'monad'), content(gw, 'monad'));
assert.equal(left(ns, 'monad').icon, 'orb:monad');
assert.equal(content(ns, 'monad').needs, 'monad', 'the shell dims it when the monad behind this door is off');

// Domains and Logs: a session is necessary and never sufficient (the server decides each request)
assert.equal(left(gw, 'domains').requires, 'session');
assert.equal(left(gw, 'logs').requires, 'session');
assert.equal(content(gw, 'domains').needs, 'both');
assert.equal(content(gw, 'logs').needs, 'backend');

// stable references: the shell memoizes on the document object, a new object per render would recompose forever
assert.equal(netgetDocumentFor('namespace'), ns);
assert.equal(netgetDocumentFor('gateway'), gw);
assert.throws(() => netgetDocumentFor('host'), /no document/);
assert.throws(() => { (gw as any).GUI.children.bars.children.left.children.extra = {}; }, TypeError, 'the documents are frozen');

// ── App.jsx composes ONE entry: no second app chosen by the hostname ───────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
const app = fs.readFileSync(path.resolve('src/htmls/Netget-REACT/frontend_local/src/App.jsx'), 'utf8');
assert.equal((app.match(/<Cleaker\b/g) || []).length, 1, 'one shell, mounted once');
assert.ok(!/<Namespace\b/.test(app), 'the bare Namespace landing is not mounted by this app any more');
assert.ok(!/ROLE\s*===\s*['"](cleaker|gateway)['"]/.test(app), 'no branch between a "cleaker" app and a "gateway" app');
assert.ok(/resolveEntry\(/.test(app) && /netgetDocumentFor\(entry\.kind\)/.test(app), 'the document is composed from the resolved entry');
assert.ok(!/const NETGET_DOCUMENT\b/.test(app), 'the document is not a constant declared for one door');

console.log('entry-composition: ok');
