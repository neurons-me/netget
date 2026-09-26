/**
 * gatewayDoorEquivalence.test.ts -- equivalence of the SHARED DEFINITIONS between the base document
 * (cleaker.me's door) and netget's own extension merged on top of it (netget.site's door). This is
 * NOT a closure of the doors migration and NOT proof the two doors are equivalent in the sense
 * GatewayAccessContract.md §1 means it (identity/path/operation/state/capabilities, never the door) --
 * see the corrections below, made explicit rather than left implied by the file's own name.
 *
 * What this genuinely shows, using the REAL objects both doors render from (not an invented copy):
 * every route/sidebar item the BASE document declares keeps the same id/component/label whether read
 * unmerged (as cleaker.me's door does) or merged with netget's extension (as netget.site's door does),
 * and the dynamic namespace-declared layer composes the same way regardless of which door's builtin
 * layer it is layered onto.
 *
 * What it does NOT show, and must not be read as showing:
 *   - That a browser actually mounts the named component correctly -- same component NAME is not
 *     proof of correct mounting; only a real render (this session's separate, uncommitted, manual
 *     Playwright checks) touched that, and those are not repeatable here.
 *   - Anything about the COMPILED package the app actually consumes (`this.gui/runtime`'s dist) --
 *     this test imports the GUI package's SOURCE directly (see below) specifically because the dist
 *     bundle does not run under plain Node, which means the dist itself stays unverified by this file.
 *   - Real reads, real permissions, or equivalence through nginx -- resolveSidebarComposition here
 *     runs on a hand-built ScopeData fixture, not a live monad, and no HTTP/proxy layer is in the loop.
 *
 * A separate, real problem this test's own passing result does NOT excuse (recorded in
 * GatewayAccessContract.md, not fixed here): today Dashboard/Domains/Logs are merged into
 * netget.site's door because of ROLE (`frontendRole({host, boot})`, App.jsx), not because of what node
 * the resolved mount reference points at. That is exactly the door-decides-content violation §1 rules
 * out. If both doors resolved to the SAME node with the SAME identity and capabilities, both should see
 * these pages; a difference in what renders must come from a difference in the mount reference and the
 * document, never from the hostname. This test cannot catch that, because it feeds each door its
 * CURRENT, real (host-derived) document input rather than asserting what that input ought to be.
 */
import assert from 'node:assert/strict';
// Straight from source (not the published this.gui/runtime dist, which bundles unrelated MUI-touching
// code into the same chunk and can't run under plain Node/tsx) -- these are pure, dependency-free
// functions; this is the same way the GUI package's own guiDocument.test.ts imports them.
import {
  GUI_DOCUMENT,
  mergeGuiDocument,
  leftBarSlots,
  flattenGuiDocument,
} from '../../../../packages/GUI/Typescript/src/runtime/guiDocument.ts';
import { resolveSidebarComposition, type ScopeData } from '../../../../packages/GUI/Typescript/src/gui/Layout/Sidebars/Composition/sidebarComposition.ts';
import { GATEWAY_DOCUMENT_EXTENSION } from '../src/htmls/Netget-REACT/frontend_local/src/session/gatewayDocument.js';

// cleaker.me's door: the base document, unmerged (App.jsx: `<CleakerLanding cleakerEndpoint={...} />`,
// no `document` prop).
const cleakerDoor = GUI_DOCUMENT;
// netget.site's door: the base document plus this app's own extension (App.jsx: `document={GATEWAY_DOCUMENT_EXTENSION}`).
const gatewayDoor = mergeGuiDocument(GUI_DOCUMENT, GATEWAY_DOCUMENT_EXTENSION);

// ── Same route, same component, on both doors ──────────────────────────────────────────────────────
{
  const cleakerRoutes = new Map(flattenGuiDocument(cleakerDoor).filter((e) => e.route).map((e) => [e.route!, e]));
  const gatewayRoutes = new Map(flattenGuiDocument(gatewayDoor).filter((e) => e.route).map((e) => [e.route!, e]));

  // every route cleaker.me's door serves, netget.site's door serves identically -- same component,
  // same id, same label
  for (const [route, entry] of cleakerRoutes) {
    const same = gatewayRoutes.get(route);
    assert.ok(same, `${route}: missing on the gateway door`);
    assert.equal(same!.component, entry.component, `${route}: different component on the gateway door`);
    assert.equal(same!.id, entry.id, `${route}: different document id on the gateway door`);
    assert.equal(same!.label, entry.label, `${route}: different label on the gateway door`);
  }
  assert.ok(cleakerRoutes.size > 0, 'sanity: the base document actually declares routes');

  // As currently wired (App.jsx, by ROLE/host -- see this file's own header), the gateway's own
  // routes exist only on this door. That is a fact about today's code, not a claim that it is right:
  // per section 1, which door served the page should never be why a route exists or doesn't.
  for (const extra of ['/dashboard', '/domains', '/logs']) {
    assert.ok(!cleakerRoutes.has(extra), `${extra}: must not leak onto cleaker.me's own door`);
    assert.ok(gatewayRoutes.has(extra), `${extra}: missing on the gateway door that declared it`);
  }

  // /netget needed NO extension at all -- same route, same component, same id on both, already true
  // above, asserted again explicitly because it's the one step-3 specifically relied on
  assert.equal(gatewayRoutes.get('/netget')?.component, cleakerRoutes.get('/netget')?.component);
  assert.equal(gatewayRoutes.get('/netget')?.component, 'Netget');
}

// ── Same sidebar items, same order, on both doors (for what the base declares) ────────────────────
{
  for (const authenticated of [false, true]) {
    const cleakerSlots = leftBarSlots(cleakerDoor, { authenticated });
    const gatewaySlots = leftBarSlots(gatewayDoor, { authenticated });
    const idsOf = (els: { props: { id: string } }[]) => els.map((e) => e.props.id);

    // every element cleaker.me's door shows, netget.site's door shows too, unchanged, in the same slot
    for (const slot of ['start', 'defaults', 'end'] as const) {
      for (const el of (cleakerSlots as any)[slot]) {
        const match = (gatewaySlots as any)[slot].find((g: any) => g.props.id === el.props.id);
        assert.ok(match, `authenticated=${authenticated} ${slot}: "${el.props.id}" missing on the gateway door`);
        assert.deepEqual(match.props, el.props, `authenticated=${authenticated} ${slot}: "${el.props.id}" differs on the gateway door`);
      }
    }
    // Same caveat as above: this documents what the current, host-derived wiring does, not an
    // endorsement of deciding it by host.
    assert.ok(
      idsOf(gatewaySlots.defaults).length > idsOf(cleakerSlots.defaults).length,
      `authenticated=${authenticated}: the gateway door should have MORE default items, not the same set`
    );
    for (const extra of ['dashboard', 'domains', 'logs']) {
      assert.ok(idsOf(gatewaySlots.defaults).includes(extra), `authenticated=${authenticated}: "${extra}" missing from the gateway door's sidebar`);
      assert.ok(!idsOf(cleakerSlots.defaults).includes(extra), `authenticated=${authenticated}: "${extra}" leaked onto cleaker.me's own door`);
    }
    // Keychain: session-gated on BOTH doors identically (not just present/absent by accident)
    assert.equal(idsOf(cleakerSlots.end).includes('keychain'), authenticated);
    assert.equal(idsOf(gatewaySlots.end).includes('keychain'), authenticated);
  }
}

// ── The dynamic layer (what the NAMESPACE itself declares) composes identically on both doors, even
// though the two doors start from different-sized builtin layers ────────────────────────────────────
{
  // What a real namespace's public root scope might add (useCleakerRootSidebar's 'visited' layer) --
  // same shape readScopePublic() returns, not fabricated: a ScopeData of real elements plus a hidden id.
  const visited: ScopeData = {
    itemIds: ['about'],
    items: { about: { type: 'link', props: { id: 'about', label: 'About', to: '/about', icon: 'info' } } },
    hiddenIds: ['url'], // the namespace hides one of the base document's own builtin defaults
  };

  const cleakerBuiltin: ScopeData = { itemIds: [], items: {} };
  leftBarSlots(cleakerDoor).defaults.forEach((el: any) => {
    cleakerBuiltin.itemIds.push(el.props.id);
    cleakerBuiltin.items[el.props.id] = el;
  });
  const gatewayBuiltin: ScopeData = { itemIds: [], items: {} };
  leftBarSlots(gatewayDoor).defaults.forEach((el: any) => {
    gatewayBuiltin.itemIds.push(el.props.id);
    gatewayBuiltin.items[el.props.id] = el;
  });

  const cleakerResolved = resolveSidebarComposition(['builtin', 'visited'], { builtin: cleakerBuiltin, visited });
  const gatewayResolved = resolveSidebarComposition(['builtin', 'visited'], { builtin: gatewayBuiltin, visited });
  const idsOf = (r: typeof cleakerResolved) => r.map((x) => x.element.props.id).sort();

  // the namespace's own addition ("about") appears, identically, through either door
  assert.ok(idsOf(cleakerResolved).includes('about'));
  assert.ok(idsOf(gatewayResolved).includes('about'));
  // and its hide ("url") is honoured, identically, through either door -- the composition semantics
  // don't change just because the gateway door's builtin layer is bigger
  assert.ok(!idsOf(cleakerResolved).includes('url'), 'cleaker.me door: hidden id leaked through');
  assert.ok(!idsOf(gatewayResolved).includes('url'), 'gateway door: hidden id leaked through');
  // the gateway-only items are still there alongside the namespace's own addition
  for (const extra of ['dashboard', 'domains', 'logs']) assert.ok(idsOf(gatewayResolved).includes(extra));
}

console.log('gatewayDoorEquivalence.test.ts: all assertions passed');
