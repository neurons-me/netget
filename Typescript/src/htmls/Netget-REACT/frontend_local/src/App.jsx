import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { Layout, ThemeLauncher, LauncherPopoverProvider, GatewaySetup, createNetgetSetupClient } from 'this.gui';
import { SeedSessionProvider, MeLauncher, CleakerLanding, HostSurface } from 'this.gui/react';
import { DevToolsLauncher, SpecBoundary } from 'this.gui/devtools';
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

// One client for this tab's lifetime, at module scope — NOT inside a
// render, and NOT re-created per navigation. Holds nothing secret: no
// identity, no key, no passphrase — signing happens entirely on the
// Cleaker origin that actually holds the claimant's keychain (see
// CleakerNetgetClaimView in CleakerLanding.tsx). This client only talks
// to netget's own backend (verify code, issue challenge, resolve where to
// redirect, submit whatever signed proof comes back).
const netgetSetupClient = createNetgetSetupClient('');

function GatewayEntry() {
  return (
    <GatewaySetup
      endpoint=""
      onSubmitSetupCode={netgetSetupClient.onSubmitSetupCode}
      onVerifySetupCode={netgetSetupClient.onVerifySetupCode}
      resolveCleakerClaimUrl={netgetSetupClient.resolveCleakerClaimUrl}
      onCommitClaim={netgetSetupClient.onCommitClaim}
    />
  );
}

// Home/Domains/Logs are plain components that take no props, so they never
// forward data-gui-node-id to any DOM element — a SpecBoundary spec'd
// directly as `{ type: Home }` registers into the graph but has no DOM
// anchor to click. Wrapping in a `display: contents` div (registered here
// as a native-tag passthrough) gives it one without touching those pages.
const PAGE_WRAPPER_REGISTRY = { div: 'div' };

// Hoisted to module scope, not inlined as JSX prop literals: SpecBoundary's
// internal renderNode() is memoized on `spec` by reference. An inline object
// literal is a new reference every render, and registering a node is itself
// a state change that re-renders everything under SelectionProvider —
// including NetGetShell — which would recreate the literal and register
// again, forever. These never change, so a stable module-level reference
// is both correct and the simplest fix (no memo hook needed).
const HOME_SPEC = {
  type: 'div',
  props: { 'data-gui-component': 'Home', style: { display: 'contents' } },
  provenance: {
    source: 'pages/Home.jsx',
    note: 'Renders GatewayDashboard (netget.gui/compounds) — REST-polled (/gateway-identity, /apps), no kernel binding.',
  },
  children: { type: Home },
};

const DOMAINS_SPEC = {
  type: 'div',
  props: { 'data-gui-component': 'Domains', style: { display: 'contents' } },
  provenance: {
    source: 'pages/Domains.jsx',
    note: 'Domain routing CRUD — REST-backed (fetch to /domains, /add-domain, /delete-domain, /provision-cert), no kernel binding.',
  },
  children: { type: Domains },
};

const LOGS_SPEC = {
  type: 'div',
  props: { 'data-gui-component': 'Logs', style: { display: 'contents' } },
  provenance: {
    source: 'pages/Logs.jsx',
    note: 'Nginx log viewer — REST-backed (fetch to /logs), optional client-side auto-refresh, no kernel binding.',
  },
  children: { type: Logs },
};

const navItems = [
  { label: 'Home', icon: 'home', to: '/' },
  { label: 'Dashboard', icon: 'dashboard', to: '/home' },
  { label: 'Domains', icon: 'language', to: '/domains' },
  { label: 'Logs', icon: 'article', to: '/logs' },
];

function NetGetShell() {
  const { pathname } = useLocation();

  return (
    <Layout
      TopBar={false}
      LeftBar={{
        initialView: 'rail',
        header: { title: 'NetGet', icon: 'hub' },
        elements: navItems.map((item) => ({
          type: 'link',
          props: {
            ...item,
            active: pathname === item.to,
          },
        })),
        footerElements: [
          {
            type: 'action',
            props: {
              label: 'Dev Tools',
              element: <DevToolsLauncher />,
              // Both launchers already open their own hover popper — the
              // rail's own label Tooltip would anchor to the same icon and
              // collide with it otherwise (see LeftSidebarAction's
              // `tooltip` prop doc, this.gui/runtime/LeftSidebarAction).
              tooltip: false,
            },
          },
          {
            type: 'action',
            props: {
              label: 'Theme',
              element: <ThemeLauncher />,
              tooltip: false,
            },
          },
          {
            type: 'action',
            props: {
              label: 'Frontend Mode',
              element: <FrontendModeLauncher />,
              tooltip: false,
            },
          },
          {
            type: 'action',
            props: {
              label: '.me',
              element: <MeLauncher cleakerEndpoint="http://local.cleaker" />,
              tooltip: false,
            },
          },
        ],
      }}
    >
      <Routes>
        {/* GatewaySetup owns "/" now — it resolves the real setup phase
            itself (checking/unreachable/dependencies/unclaimed/claimed)
            and hands off to whatever comes after claiming. WelcomeNetget.jsx
            is left on disk, un-routed, not deleted — its fate (retire vs.
            merge its still-useful pieces) is a separate decision. */}
        <Route path="/" element={<GatewayEntry />} />
        <Route
          path="/home"
          element={<SpecBoundary registry={PAGE_WRAPPER_REGISTRY} spec={HOME_SPEC} />}
        />
        <Route
          path="/domains"
          element={<SpecBoundary registry={PAGE_WRAPPER_REGISTRY} spec={DOMAINS_SPEC} />}
        />
        <Route
          path="/logs"
          element={<SpecBoundary registry={PAGE_WRAPPER_REGISTRY} spec={LOGS_SPEC} />}
        />
        <Route path="/terms-and-conditions" element={<MediaPage><TermsAndConditions /></MediaPage>} />
        <Route path="/privacy-policy" element={<MediaPage><PrivacyPolicy /></MediaPage>} />
      </Routes>
    </Layout>
  );
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
//     hostname, ...): netget's own admin dashboard/sidebar.
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

// This page had NO boot injected (no monad served it -- netget.site's own index.html is a plain static
// file, GatewayAccessContract.md §7's gap 2): it cannot assume where it is mounted in `.me` from its
// hostname, so it fetches the same mount reference an injected boot would have carried
// (`GET <providerOrigin>/__provider`, this.gui/runtime's fetchMountReference) before rendering the
// gateway shell. `providerOrigin` is this app's own boot configuration (netgetMonadTransportOrigin(),
// already the address every other request on this page uses) -- never guessed from window.location, and
// this component reads no hostname either. An unresolved reference shows an explicit state instead of
// silently rendering the shell as if resolution had succeeded.
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
          <Router>
            <Routes>
              <Route path="/*" element={<NetGetShell />} />
            </Routes>
          </Router>
        </GatewayMountBoundary>
      )}
    </LauncherPopoverProvider>
  </SeedSessionProvider>
);

export default App;
