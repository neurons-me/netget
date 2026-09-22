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
import { readProviderBoot, frontendRole, namespaceEndpoint } from './session/providerBoot.js';

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

// What THIS app adds on top of the root GUI's document (GatewayAccessContract.md §7, doors migration
// step 3): its own pages and their left-bar entries, merged into the same document cleaker.me's own
// door already renders from -- not a second application. `/netget` (status + claim) is already in the
// base document; nothing netget-specific needs to be added for it.
const GATEWAY_DOCUMENT_EXTENSION = {
  GUI: {
    children: {
      bars: {
        children: {
          left: {
            children: {
              dashboard: { label: 'Dashboard', to: '/dashboard', icon: 'dashboard' },
              domains: { label: 'Domains', to: '/domains', icon: 'language' },
              logs: { label: 'Logs', to: '/logs', icon: 'article' },
            },
          },
        },
      },
      content: {
        children: {
          dashboard: {
            label: 'Dashboard', component: 'Dashboard', route: '/dashboard',
            note: 'Renders GatewayDashboard (netget.gui/compounds) — REST-polled (/gateway-identity, /apps), no kernel binding.',
          },
          domains: {
            label: 'Domains', component: 'Domains', route: '/domains',
            note: 'Domain routing CRUD — REST-backed (fetch to /domains, /add-domain, /delete-domain, /provision-cert), no kernel binding.',
          },
          logs: {
            label: 'Logs', component: 'Logs', route: '/logs',
            note: 'Nginx log viewer — REST-backed (fetch to /logs), optional client-side auto-refresh, no kernel binding.',
          },
          termsAndConditions: { component: 'TermsAndConditions', route: '/terms-and-conditions' },
          privacyPolicy: { component: 'PrivacyPolicy', route: '/privacy-policy' },
        },
      },
    },
  },
};

const GATEWAY_PAGE_REGISTRY = {
  Dashboard: withNodeAnchor(Home),
  Domains: withNodeAnchor(Domains),
  Logs: withNodeAnchor(Logs),
  TermsAndConditions: () => <MediaPage><TermsAndConditions /></MediaPage>,
  PrivacyPolicy: () => <MediaPage><PrivacyPolicy /></MediaPage>,
};

// This page had NO boot injected (no monad served it -- netget.site's own index.html is a plain static
// file, GatewayAccessContract.md §7's gap 2): it cannot assume where it is mounted in `.me` from its
// hostname, so it fetches the same mount reference an injected boot would have carried
// (`GET <providerOrigin>/__provider`, this.gui/runtime's fetchMountReference) before rendering the
// gateway shell. `providerOrigin` is this app's own boot configuration (netgetMonadTransportOrigin(),
// already the address every other request on this page uses) -- never guessed from window.location, and
// this component reads no hostname either. An unresolved reference shows an explicit state instead of
// silently rendering the shell as if resolution had succeeded.
//
// This does not "discover" where the page belongs on its own initiative -- it asks the provider this
// app was configured with, the same way a reference handed down by a router (netget's own domain
// routing, still a separate idea, not built here) would arrive already resolved instead of fetched.
// Either way, once a reference is in hand, the shell below works the same.
function GatewayMountBoundary({ children }) {
  const [reference, setReference] = useState(() => (PROVIDER_BOOT ? { status: 'resolved' } : { status: 'checking' }));

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

  if (reference.status === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }
  if (reference.status === 'unresolved') {
    return (
      <div style={{ maxWidth: 480, margin: '15vh auto', padding: '0 24px', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>Can't tell where this gateway is in the namespace</h2>
        <p style={{ opacity: 0.7, marginBottom: 4 }}>
          This page could not resolve its own mount reference ({reference.reason}).
        </p>
        {reference.detail ? <p style={{ opacity: 0.5, fontSize: 13 }}>{reference.detail}</p> : null}
      </div>
    );
  }
  return children;
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
//     hostname, ...): the SAME shell cleaker's door renders, with this app's
//     own pages (Dashboard/Domains/Logs) merged on top -- not a second,
//     hand-written admin app. `/` still renders the base document's Landing
//     (sign-in), same as any other door: an extension may add parts, never
//     replace the one the base already serves at `/` (mergeGuiDocument's own
//     rule, tested). Which door's default screen is administration is a
//     real, separate decision -- not made here.
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

const App = () => (
  <SeedSessionProvider
    transportOrigin={netgetMonadTransportOrigin()}
    resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
    sessionBackend="cleaker"
  >
    <LauncherPopoverProvider>
      {ROLE === 'cleaker' ? (
        <CleakerLanding cleakerEndpoint={CLEAKER_ENDPOINT} netgetMonadOrigin={CLEAKER_MONAD_ORIGIN} />
      ) : ROLE === 'host' ? (
        <HostSurface endpoint={netgetMonadTransportOrigin()} />
      ) : (
        <GatewayMountBoundary>
          <CleakerLanding
            cleakerEndpoint={GATEWAY_ENDPOINT}
            netgetMonadOrigin={netgetMonadTransportOrigin()}
            document={GATEWAY_DOCUMENT_EXTENSION}
            pages={GATEWAY_PAGE_REGISTRY}
            footerExtras={[{ type: 'action', props: { label: 'Frontend Mode', element: <FrontendModeLauncher />, tooltip: false } }]}
          />
        </GatewayMountBoundary>
      )}
    </LauncherPopoverProvider>
  </SeedSessionProvider>
);

export default App;
