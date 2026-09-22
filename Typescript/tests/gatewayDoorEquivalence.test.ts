/**
 * gatewayDoorEquivalence.test.ts -- doors migration step 4 (GatewayAccessContract.md §7):
 * same namespace + identity → same sidebar items and same component per route, on either door.
 *
 * Imports the REAL objects both doors render from, not copies: `cleaker.me`'s door renders the GUI
 * package's own GUI_DOCUMENT unmerged; netget.site's door merges netget's own real
 * GATEWAY_DOCUMENT_EXTENSION (frontend_local/src/session/gatewayDocument.js) on top of it
 * (App.jsx). This proves the merge that actually ships, not a stand-in for it.
 *
 * "Equivalence" here does not mean "identical" -- netget.site's door legitimately adds Dashboard,
 * Domains and Logs, which cleaker.me's door does not have (GatewayAccessContract.md §7: "administrative
 * screens... don't have to use the API's prefix", and are declared as an app's own extension). What must
 * be identical is the SHARED part of the tree: every route/sidebar item the base document declares
 * renders through the exact same component, unchanged, on both doors; the gateway's extra items are
 * additive, never a replacement, and never leak backwards into cleaker.me's own door.
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

  // the gateway's own routes are ADDITIONS, not present on cleaker.me's door at all
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
    // the gateway's own extra items are additions to `defaults`, not a replacement of cleaker's
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
