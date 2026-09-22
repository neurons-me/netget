import { useEffect, useState } from 'react';
import { LauncherPopoverProvider } from 'this.gui';
import { SeedSessionProvider, CleakerLanding, HostSurface } from 'this.gui/react';
import { fetchMountReference } from 'this.gui/runtime';
import Home from './pages/Home.jsx';
import Logs from './pages/Logs.jsx';
import Domains from './pages/Domains.jsx';
import MediaPage from './pages/Media/MediaPage.jsx';
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx';
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx';
import FrontendModeLauncher from './components/FrontendModeLauncher/FrontendModeLauncher.jsx';
import { resolveNetgetSeedFromCredentials, netgetMonadTransportOrigin } from './session/resolveNetgetSeed.js';
import { readProviderBoot, frontendRole, namespaceEndpoint, bootNodePath } from './session/providerBoot.js';
import { GATEWAY_DOCUMENT_EXTENSION } from './session/gatewayDocument.js';

// Two layers, composed, never conflated (GatewayAccessContract.md §8):
//   DOCUMENT   "I am this app, with this structure, these pages, this own content" -- authored,
//              fixed, known at build time. Which bundle/entry point this is decides it (this IS
//              netget's own admin app, unconditionally -- not something a namespace connection
//              could make true or false).
//   NAMESPACE  "this is the context I offer: data, identity, permissions, extensions" -- a
//              CONNECTION the document makes, not a fact about which document it is. The same
//              document connected to namespace A shows A's data/capabilities; connected to B,
//              B's; unconnected, its own local content. Checking "is this gateway's own root"
//              to decide WHICH DOCUMENT renders was exactly the bug (a prior pass in this same
//              file still did this via `isGatewayMonad`) -- the document never asks that
//              question; only the connection layer does, and only to resolve data/capabilities.
//
// Today this document's connection target defaults to the namespace this page's own address
// suggests (netgetMonadTransportOrigin()) -- offered as the initial context, not hardcoded as the
// only possible one, and not yet something the person can change at runtime (a real, separate
// feature: switching context would need this document's data/requests/subscriptions kept apart
// per namespace, and switching grants nothing automatically -- the new namespace's own
// permissions apply). Not built here.

// Home/Domains/Logs are plain components that take no props, so they never forward
// data-gui-node-id/data-gui-component to any DOM element -- renderGuiDocumentPage injects both onto
// whatever it renders, so a bare `<Home />` would just drop them. A `display: contents` anchor gives
// each one a real node without touching the page itself (contents: the wrapper adds no layout box).
function withNodeAnchor(Component) {
  return function NodeAnchor({ 'data-gui-node-id': nodeId, 'data-gui-component': nodeComponent, ...rest }) {
    return (
      <div data-gui-node-id={nodeId} data-gui-component={nodeComponent} style={{ display: 'contents' }}>
        <Component {...rest} />
      </div>
    );
  };
}

// The document shape itself lives in gatewayDocument.js (plain data, no JSX) so
// tests/gatewayDoorEquivalence.test.ts can import the REAL extension directly, not a copy of it.
const GATEWAY_PAGE_REGISTRY = {
  Dashboard: withNodeAnchor(Home),
  Domains: withNodeAnchor(Domains),
  Logs: withNodeAnchor(Logs),
  TermsAndConditions: () => <MediaPage><TermsAndConditions /></MediaPage>,
  PrivacyPolicy: () => <MediaPage><PrivacyPolicy /></MediaPage>,
};

// Never a full-page gate: "unresolved" means this document could not connect to its namespace
// context right now, not that it has nothing to show. The document (its own structure and pages)
// renders regardless -- only the parts that genuinely need that connection (MainServerView, the
// base document's namespace-declared sidebar layer, GatewayDashboard's own fetches) show their own
// "not available" state, each already doing that on its own, never fabricating data.
function MountReferenceNotice({ reference }) {
  if (reference.status !== 'unresolved') return null;
  return (
    <div style={{ padding: '4px 16px', fontSize: 12, opacity: 0.6, borderBottom: '1px solid rgba(127,127,127,0.2)' }}>
      Not connected to a namespace context ({reference.reason}) — showing local content only.
    </div>
  );
}

// The mount reference (GatewayAccessContract.md §7) this document is currently connected to:
// namespace + node path. For a page the monad injected a boot into, this is already in hand
// (synchronous, no fetch). For a standalone file (netget.site's static index.html), it is fetched
// once from the SAME configured provider every other request on this page already uses
// (netgetMonadTransportOrigin(), never window.location, never a hardcoded app name). This describes
// the CONNECTION only -- it never decides which document/pages exist, see this file's own header.
function useMountReference() {
  const [reference, setReference] = useState(() =>
    PROVIDER_BOOT
      ? { status: 'resolved', namespace: PROVIDER_BOOT.namespace, rootNamespace: PROVIDER_BOOT.rootNamespace, nodePath: bootNodePath(PROVIDER_BOOT) }
      : { status: 'checking' }
  );

  useEffect(() => {
    if (PROVIDER_BOOT) return undefined; // already have a description; nothing to fetch
    let cancelled = false;
    fetchMountReference(netgetMonadTransportOrigin()).then((result) => {
      if (!cancelled) setReference(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return reference;
}

// Three distinct jobs, decided by where this page was loaded (see
// session/providerBoot.js) -- nginx's bare "/" is one static file shared by
// every admin-block hostname, and a monad hands the same bundle to every
// namespace it serves, so which one actually loaded the page is branched
// client-side, the same way main.jsx's document.title already does:
//   cleaker  → a namespace's own landing (this.gui's CleakerLanding, entire
//     page, same session as everywhere else). local.cleaker, and any monad
//     that serves this bundle without mounting the gateway: the namespace is
//     the one the monad reports (www.cleaker.me is cleaker.me).
//   host     → local.host: this host's own hardware/activity dashboard
//     (HostSurface -- CPU/RAM/storage gauges, self-reported, not verified
//     by the mesh, plus a live request feed), pointed at netget's own
//     monad. Deliberately not Cleaker (no claim/identity/namespace jargon)
//     and not netget's admin dashboard. See the naming-migration memory for
//     the fuller local.host/@user/namespace grammar this is a first step
//     toward: today this is a fixed view, not yet real path resolution.
//   gateway  → everything else (local.netget, netget.site, the machine
//     hostname, ...): the SAME shell cleaker's door renders, PLUS this
//     app's own document extension (Dashboard/Domains/Logs) -- always, this
//     bundle IS netget's own admin app, a fact of which entry point this is,
//     never of which namespace happens to answer when it connects (see this
//     file's own header). `/` still renders the base document's Landing on
//     every door alike (mergeGuiDocument refuses to let an extension
//     override a route the base already serves) -- which door's INITIAL
//     screen is administration is a separate, further decision, not this one.
const HOST = typeof window !== 'undefined' ? window.location.hostname : '';
const PROVIDER_BOOT = readProviderBoot();
const ROLE = frontendRole({ host: HOST, boot: PROVIDER_BOOT });
// This document's own pages exist because of WHICH APP this is (ROLE), never because of what a
// namespace connection resolves to -- see this file's own header.
const IS_GATEWAY_DOCUMENT = ROLE === 'gateway';
// The monad the landing reads its directory from (Users, Blockchain). On
// local.cleaker that stays netget's own monad through /apps/netget (the
// CleakerLanding default); on a namespace served by its own monad it is that
// monad, at the address the page came from.
const CLEAKER_MONAD_ORIGIN = HOST === 'local.cleaker' || !PROVIDER_BOOT ? undefined : netgetMonadTransportOrigin();
const CLEAKER_ENDPOINT = HOST === 'local.cleaker'
  ? 'http://local.cleaker'
  : namespaceEndpoint(PROVIDER_BOOT, typeof window !== 'undefined' ? window.location : null);
// This document's OFFERED, default connection target -- the namespace this page's own address
// suggests, not the only one it could ever connect to (see this file's own header). CleakerLanding
// re-verifies it (useVerifiedCleakerRoot) rather than trusting it outright, same as every other door.
const GATEWAY_ENDPOINT = typeof window !== 'undefined' ? window.location.origin : '';

const App = () => {
  const reference = useMountReference();

  return (
    <SeedSessionProvider
      transportOrigin={netgetMonadTransportOrigin()}
      resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
      sessionBackend="cleaker"
    >
      <LauncherPopoverProvider>
        {ROLE === 'host' ? (
          <HostSurface endpoint={netgetMonadTransportOrigin()} />
        ) : (
          <>
            <MountReferenceNotice reference={reference} />
            <CleakerLanding
              cleakerEndpoint={ROLE === 'cleaker' ? CLEAKER_ENDPOINT : GATEWAY_ENDPOINT}
              netgetMonadOrigin={ROLE === 'cleaker' ? CLEAKER_MONAD_ORIGIN : netgetMonadTransportOrigin()}
              document={IS_GATEWAY_DOCUMENT ? GATEWAY_DOCUMENT_EXTENSION : undefined}
              pages={IS_GATEWAY_DOCUMENT ? GATEWAY_PAGE_REGISTRY : undefined}
              footerExtras={
                IS_GATEWAY_DOCUMENT
                  ? [{ type: 'action', props: { label: 'Frontend Mode', element: <FrontendModeLauncher />, tooltip: false } }]
                  : undefined
              }
            />
          </>
        )}
      </LauncherPopoverProvider>
    </SeedSessionProvider>
  );
};

export default App;
