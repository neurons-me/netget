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
import { readProviderBoot, frontendRole, namespaceEndpoint, isGatewayMonad, bootNodePath } from './session/providerBoot.js';
import { GATEWAY_DOCUMENT_EXTENSION } from './session/gatewayDocument.js';

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

// Never a full-page gate: "unresolved" means this page could not confirm its own place in the
// namespace right now, not that it has nothing to show. Local structure and pages render regardless
// (GatewayAccessContract.md §8 correction) -- only the parts that genuinely need a live connection
// (MainServerView, the base document's namespace-declared sidebar layer, GatewayDashboard's own
// fetches) show their own "not available" state, each already doing that on its own. This is only a
// small, non-blocking note that a connection wasn't confirmed.
function MountReferenceNotice({ reference }) {
  if (reference.status !== 'unresolved') return null;
  return (
    <div style={{ padding: '4px 16px', fontSize: 12, opacity: 0.6, borderBottom: '1px solid rgba(127,127,127,0.2)' }}>
      Not connected to this gateway's own namespace ({reference.reason}) — showing local content only.
    </div>
  );
}

// The mount reference (GatewayAccessContract.md §7): namespace + node path, and whether that
// namespace is this installation's own gateway monad. For a page the monad injected a boot into,
// this is already in hand (synchronous, no fetch). For a standalone file (netget.site's static
// index.html), it is fetched once from the SAME configured provider every other request on this
// page already uses (netgetMonadTransportOrigin(), never window.location). A resolution reached
// through `/apps/netget` is, by the same convention netgetMonadTransportOrigin() already relies on,
// this installation's own gateway monad -- not a guess this hook adds on its own.
function useMountReference() {
  const [reference, setReference] = useState(() =>
    PROVIDER_BOOT
      ? {
          status: 'resolved',
          namespace: PROVIDER_BOOT.namespace,
          rootNamespace: PROVIDER_BOOT.rootNamespace,
          nodePath: bootNodePath(PROVIDER_BOOT),
          isGatewayMonad: isGatewayMonad(PROVIDER_BOOT),
        }
      : { status: 'checking' }
  );

  useEffect(() => {
    if (PROVIDER_BOOT) return undefined; // already have a description; nothing to fetch
    let cancelled = false;
    fetchMountReference(netgetMonadTransportOrigin()).then((result) => {
      if (cancelled) return;
      setReference(
        result.status === 'resolved'
          ? { status: 'resolved', namespace: result.namespace, rootNamespace: result.rootNamespace, nodePath: result.nodePath, isGatewayMonad: true }
          : result
      );
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
//     hostname, ...): the SAME shell cleaker's door renders.
//
// Which door renders netget's own extra pages (Dashboard/Domains/Logs) is decided by the RESOLVED
// mount reference, never by ROLE/hostname (GatewayAccessContract.md §8 correction: this was the
// door-decides-content violation section 1 rules out). In this deployment both doors resolve the
// SAME namespace at its own root, so both get the extension -- a door onto some OTHER namespace's
// own monad (isGatewayMonad false there) correctly does not. `/` still renders the base document's
// Landing on every door alike (mergeGuiDocument refuses to let an extension override a route the
// base already serves) -- which door's INITIAL screen is administration is a separate, further
// decision, not this one.
const HOST = typeof window !== 'undefined' ? window.location.hostname : '';
const PROVIDER_BOOT = readProviderBoot();
const ROLE = frontendRole({ host: HOST, boot: PROVIDER_BOOT });
// The monad the landing reads its directory from (Users, Blockchain). On
// local.cleaker that stays netget's own monad through /apps/netget (the
// CleakerLanding default); on a namespace served by its own monad it is that
// monad, at the address the page came from.
const CLEAKER_MONAD_ORIGIN = HOST === 'local.cleaker' || !PROVIDER_BOOT ? undefined : netgetMonadTransportOrigin();
const CLEAKER_ENDPOINT = HOST === 'local.cleaker'
  ? 'http://local.cleaker'
  : namespaceEndpoint(PROVIDER_BOOT, typeof window !== 'undefined' ? window.location : null);
// The gateway role's own door: this very origin, the same way local.cleaker is a door of its
// namespace -- CleakerLanding re-verifies it (useVerifiedCleakerRoot) rather than trusting it outright,
// same as every other door.
const GATEWAY_ENDPOINT = typeof window !== 'undefined' ? window.location.origin : '';

const App = () => {
  const reference = useMountReference();
  // netget.site (ROLE 'gateway') unambiguously IS this app -- its own pages are local, bundled
  // content, available regardless of whether the mount reference ever resolves (the "sin anclaje:
  // muestra su documento local" case). A 'cleaker' door might be ANY namespace's own page, so THERE
  // the extension only applies once the resolved reference confirms this is genuinely the same
  // gateway's own root -- for an injected boot that confirmation is already synchronous (no network
  // wait), never left pending.
  const extensionApplies =
    ROLE === 'gateway' || (reference.status === 'resolved' && reference.nodePath === '' && reference.isGatewayMonad);

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
              document={extensionApplies ? GATEWAY_DOCUMENT_EXTENSION : undefined}
              pages={extensionApplies ? GATEWAY_PAGE_REGISTRY : undefined}
              footerExtras={
                extensionApplies
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
