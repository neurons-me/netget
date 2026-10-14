import { useEffect, useState } from 'react';
import { LauncherPopoverProvider } from 'this.gui';
import { SeedSessionProvider, Namespace, HostSurface, Cleaker, Me } from 'this.gui/react';
import { SpecBoundary } from 'this.gui/devtools';
import Home from './pages/Home.jsx';
import Logs from './pages/Logs.jsx';
import Domains from './pages/Domains.jsx';
import MediaPage from './pages/Media/MediaPage.jsx';
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx';
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx';
import { resolveNetgetSeedFromCredentials, netgetMonadTransportOrigin } from './session/resolveNetgetSeed.js';
import { readProviderBoot, frontendRole, namespaceEndpoint, mainServerDoor } from './session/providerBoot.js';
import DoorRouter from './session/DoorRouter.jsx';

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

// The pages netget adds to the shell, as components the GUI document can name. The wrapper
// pages keep their SpecBoundary so the inspector still sees them as before.
function MonadPage() {
  return <HostSurface endpoint={netgetMonadTransportOrigin()} />;
}

const MONAD_SPEC = {
  type: 'div',
  props: { 'data-gui-component': 'Monad', style: { display: 'contents' } },
  provenance: {
    source: 'this.gui HostSurface',
    note: "This netget's own monad — polls its /__bootstrap for the surface it self-reports (hardware and activity, not verified by the mesh), no kernel binding.",
  },
  children: { type: MonadPage },
};

const wrapped = (spec) => () => <SpecBoundary registry={PAGE_WRAPPER_REGISTRY} spec={spec} />;
const NETGET_PAGES = {
  NetgetDashboard: wrapped(HOME_SPEC),
  NetgetDomains: wrapped(DOMAINS_SPEC),
  NetgetLogs: wrapped(LOGS_SPEC),
  NetgetMonad: wrapped(MONAD_SPEC),
  NetgetTerms: () => <MediaPage><TermsAndConditions /></MediaPage>,
  NetgetPrivacy: () => <MediaPage><PrivacyPolicy /></MediaPage>,
};

// What netget declares on top of the root GUI document (mergeGuiDocument can add parts, never replace a
// base part's component/route). Same routes the standalone shell served, so links and bookmarks hold.
// `requires: 'session'` only hides a link until someone has signed in: it authorizes nothing. What
// Domains and Logs may do is decided by the server per request, as before.
const NETGET_DOCUMENT = {
  GUI: {
    children: {
      bars: {
        children: {
          left: {
            children: {
              dashboard: { label: 'Dashboard', to: '/home', icon: 'dashboard', placement: 'end' },
              domains: { label: 'Domains', to: '/domains', icon: 'language', requires: 'session', placement: 'end' },
              logs: { label: 'Logs', to: '/logs', icon: 'article', requires: 'session', placement: 'end' },
              // the monad.ai orb, the same one the Monad surface draws (not a generic chip icon)
              monad: { label: 'Monad', to: '/monad', icon: 'orb:monad', placement: 'end' },
            },
          },
        },
      },
      content: {
        children: {
          // `needs`: the layer behind this door the page cannot work without. When it is off the shell shows the
          // layers panel in its place and dims the sidebar link.
          dashboard: { label: 'Dashboard', component: 'NetgetDashboard', route: '/home', needs: 'backend', note: 'Gateway status (REST: /gateway-identity, /apps).' },
          domains: { label: 'Domains', component: 'NetgetDomains', route: '/domains', needs: 'both', note: 'Domain routing CRUD (REST, stored through the monad).' },
          logs: { label: 'Logs', component: 'NetgetLogs', route: '/logs', needs: 'backend', note: 'Nginx log viewer (REST).' },
          monad: { label: 'Monad', component: 'NetgetMonad', route: '/monad', needs: 'monad', note: "This netget's own monad: the surface it reports." },
          // The server answers /apps with this page to a browser and with the registry (JSON) to a program.
          apps: { label: 'Apps', component: 'NetgetDashboard', route: '/apps', needs: 'backend', note: 'The apps registered on this host (same view as the dashboard).' },
          terms: { label: 'Terms', component: 'NetgetTerms', route: '/terms-and-conditions' },
          privacy: { label: 'Privacy', component: 'NetgetPrivacy', route: '/privacy-policy' },
        },
      },
    },
  },
};

// The gateway's front end IS the Cleaker shell: one Layout, one session (Cleaker mounts the
// SeedSessionProvider -- nothing above it may), netget's views declared into its document.
// The `.me` above it is this page's local runtime; Cleaker is its link to ONE namespace: the host
// the page was served from, whose monad answers through netget's /apps/<name> transport.
const GATEWAY_NAMESPACE = typeof window !== 'undefined' ? window.location.hostname : '';

// What the gateway says about itself. null when it did not answer (then the address bar's host is the namespace, as
// before). A bounded wait: the page must not hang on a refused or slow route.
function readDeclaredMainServer(signal) {
  return fetch('/main-server-namespace', { cache: 'no-store', credentials: 'same-origin', signal })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

function GatewayApp() {
  // undefined = still asking, null = nothing declared, object = the door the page is on
  const [door, setDoor] = useState(undefined);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let cancelled = false;
    readDeclaredMainServer(controller.signal).then((declared) => {
      clearTimeout(timer);
      if (cancelled) return;
      const resolved = mainServerDoor({ host: GATEWAY_NAMESPACE, declared, pathname: window.location.pathname });
      // Before Cleaker mounts: an old link to "/netget" on this door is "/" (cleaker.me/netget/netget is not a page).
      if (resolved.canonicalPath) {
        window.history.replaceState(window.history.state, '', `${resolved.canonicalPath}${window.location.search}${window.location.hash}`);
      }
      setDoor(resolved);
    });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, []);
  if (door === undefined) return null;
  const shell = (
    <Cleaker
      namespace={door.namespace || GATEWAY_NAMESPACE}
      transport={netgetMonadTransportOrigin()}
      resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
      document={NETGET_DOCUMENT}
      pages={NETGET_PAGES}
      // Dashboard and URL are not in the rail for now. The main server's own door is netget's app, not the namespace,
      // so its directory views (Users, Blockchain) are not this app's navigation either. Icons only -- the pages and
      // their routes still exist.
      hideBarItems={door.isMainServerDoor ? ['users', 'blockchain', 'url', 'dashboard'] : ['url', 'dashboard']}
      // Where the position label points inside the namespace. Only what a door DECLARES counts: the main server's door
      // is the namespace's `netget` node (netget.site/ -> cleaker.me/netget); everywhere else the label is the namespace's
      // root. A GUI route such as /domains or /logs is where this page navigated, not a node of the namespace.
      semanticPath={door.isMainServerDoor ? '/netget' : '/'}
    />
  );
  return (
    <LauncherPopoverProvider>
      <Me>
        {door.isMainServerDoor ? <DoorRouter>{shell}</DoorRouter> : shell}
      </Me>
    </LauncherPopoverProvider>
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

const App = () => (
  ROLE === 'gateway' ? (
    <GatewayApp />
  ) : (
    <SeedSessionProvider
      transportOrigin={netgetMonadTransportOrigin()}
      resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
      sessionBackend="cleaker"
    >
      <LauncherPopoverProvider>
        {ROLE === 'cleaker' ? (
          <Namespace cleakerEndpoint={CLEAKER_ENDPOINT} netgetMonadOrigin={CLEAKER_MONAD_ORIGIN} />
        ) : (
          <HostSurface endpoint={netgetMonadTransportOrigin()} />
        )}
      </LauncherPopoverProvider>
    </SeedSessionProvider>
  )
);

export default App;
