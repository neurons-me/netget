import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { Layout, ThemeLauncher, LauncherPopoverProvider } from 'this.gui';
import { SeedSessionProvider, MeLauncher, CleakerLanding } from 'this.gui/react';
import { DevToolsLauncher, SpecBoundary } from 'this.gui/devtools';
import WelcomeNetget from './pages/WelcomeMedia/WelcomeNetget.jsx';
import Home from './pages/Home.jsx';
import Logs from './pages/Logs.jsx';
import Domains from './pages/Domains.jsx';
import MediaPage from './pages/Media/MediaPage.jsx';
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx';
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx';
import FrontendModeLauncher from './components/FrontendModeLauncher/FrontendModeLauncher.jsx';
import { resolveNetgetSeedFromCredentials, netgetMonadTransportOrigin } from './session/resolveNetgetSeed.js';

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
        <Route path="/" element={<WelcomeNetget />} />
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

// local.cleaker's whole job is identity — it gets its own landing (the
// same session as everywhere else, this.gui's CleakerLanding as the
// entire page) instead of netget's admin dashboard/sidebar. local.host is
// deliberately NOT in this list: it's the general local host surface/entry
// point (same role as local.netget — the machine's own admin dashboard),
// not the cleaker service itself. local.cleaker is one namespace reachable
// from that surface, not replaced by it — see the naming-migration memory
// for the fuller local.host/@user/namespace grammar this is heading toward.
// Every other host (local.netget, local.host, the machine hostname, ...) is
// unaffected — nginx's bare "/" is a static file shared by every
// admin-block hostname (setNginxConfigRoutes.ts), so this has to branch
// client-side on the hostname that actually loaded the page, the same way
// main.jsx's document.title already does.
const IS_CLEAKER_HOST = typeof window !== 'undefined' && window.location.hostname === 'local.cleaker';

const App = () => (
  <SeedSessionProvider
    transportOrigin={netgetMonadTransportOrigin()}
    resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
    sessionBackend="cleaker"
  >
    <LauncherPopoverProvider>
      {IS_CLEAKER_HOST ? (
        <CleakerLanding cleakerEndpoint="http://local.cleaker" />
      ) : (
        <Router>
          <Routes>
            <Route path="/*" element={<NetGetShell />} />
          </Routes>
        </Router>
      )}
    </LauncherPopoverProvider>
  </SeedSessionProvider>
);

export default App;
