import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { LauncherPopoverProvider, MonadNamespaceCard } from 'this.gui';
import { SeedSessionProvider, HostSurface, Cleaker, Me } from 'this.gui/react';
import { SpecBoundary } from 'this.gui/devtools';
import Home from './pages/Home.jsx';
import Logs from './pages/Logs.jsx';
import Domains from './pages/Domains.jsx';
import MediaPage from './pages/Media/MediaPage.jsx';
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx';
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx';
import { resolveNetgetSeedFromCredentials, netgetMonadTransportOrigin } from './session/resolveNetgetSeed.js';
import { readProviderBoot, frontendRole } from './session/providerBoot.js';
import { resolveEntry, needsDeclaration, netgetDocumentFor } from './session/entryContext.js';
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
// The monad's own page: the orb, large, and under it the mesh -- the monads that are live under this namespace, read
// from the gateway's registry (/apps). Read-only: waking or restarting monads is an operator action that needs its own
// authorization, so no controls are offered here. The HOST's hardware view is not this page's: it is the gateway's
// (pages/Home.jsx, the dashboard).
const MESH_POLL_MS = 5000;

function monadsFromRegistry(registry) {
  const now = Date.now();
  return (Array.isArray(registry?.apps) ? registry.apps : [])
    .filter((a) => String(a?.name || '').startsWith('monad:') || a?.kind === 'monad')
    .map((a) => {
      const ttl = Number(a.ttlMs) > 0 ? Number(a.ttlMs) : 45_000;
      const seen = Number(a.lastSeenMs) || 0;
      return {
        name: String(a.name || '').replace(/^monad:/, ''),
        port: Number(a.port) || 0,
        healthy: seen > 0 && now - seen <= ttl,
      };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}

function MonadPage() {
  const [apps, setApps] = useState([]);
  // null while unknown: the orb keeps its default glow until the monad has answered or refused
  const [healthy, setHealthy] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const res = await fetch('/apps', { cache: 'no-store', credentials: 'same-origin' });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) setApps(monadsFromRegistry(data));
      } catch {
        if (!cancelled) setApps([]);
      }
      try {
        const res = await fetch(`${netgetMonadTransportOrigin()}/__surface`, { cache: 'no-store' });
        if (!cancelled) setHealthy(res.ok);
      } catch {
        if (!cancelled) setHealthy(false);
      }
    };
    read();
    const timer = setInterval(read, MESH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return (
    <Box sx={{ px: 3, py: 3, width: '100%', maxWidth: 560, mx: 'auto', boxSizing: 'border-box' }}>
      <MonadNamespaceCard healthy={healthy} apps={apps} orbScale={2} meshDefaultOpen />
    </Box>
  );
}

const MONAD_SPEC = {
  type: 'div',
  props: { 'data-gui-component': 'Monad', style: { display: 'contents' } },
  provenance: {
    source: 'this.gui MonadNamespaceCard',
    note: "This netget's own monad: the orb (reachability of its /__surface) and the mesh of monads registered with the gateway (/apps, polled). Read-only.",
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

// ONE entry for every door. The page mounts the Cleaker shell -- one Layout, one session (Cleaker mounts the
// SeedSessionProvider, nothing above it may) -- and netget's views are declared into its document. The address bar does not
// pick an app: it contributes CONTEXT. Which namespace this page links to, and where it is reached, is what the monad that
// served the page said (a namespace's own door) or what the gateway declares (/main-server-namespace); only when neither
// did, the hostname is a draft of it (see session/entryContext.js for what each context composes).
const HOST_NAME = typeof window !== 'undefined' ? window.location.hostname : '';
const PROVIDER_BOOT = readProviderBoot();

// What the gateway says about itself. null when it did not answer (then the address bar's host is the namespace, as
// before). A bounded wait: the page must not hang on a refused or slow route.
function readDeclaredMainServer(signal) {
  return fetch('/main-server-namespace', { cache: 'no-store', credentials: 'same-origin', signal })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

const resolveHere = (declared) => resolveEntry({ host: HOST_NAME, boot: PROVIDER_BOOT, declared, pathname: window.location.pathname });

function EntryApp() {
  // A namespace door was already told its namespace by the monad: nothing to ask. Any other door asks the gateway which door
  // it is. undefined = still asking; otherwise the resolved entry.
  const asks = needsDeclaration({ host: HOST_NAME, boot: PROVIDER_BOOT });
  const [entry, setEntry] = useState(() => (asks ? undefined : resolveHere(null)));
  useEffect(() => {
    if (!asks) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let cancelled = false;
    readDeclaredMainServer(controller.signal).then((declared) => {
      clearTimeout(timer);
      if (cancelled) return;
      const resolved = resolveHere(declared);
      // Before Cleaker mounts: an old link to "/netget" on the main server's door is "/" (cleaker.me/netget/netget is not a page).
      if (resolved.canonicalPath) {
        window.history.replaceState(window.history.state, '', `${resolved.canonicalPath}${window.location.search}${window.location.hash}`);
      }
      setEntry(resolved);
    });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [asks]);
  if (entry === undefined) return null;
  const shell = (
    <Cleaker
      namespace={entry.namespace || HOST_NAME}
      namespaceSource={entry.namespaceSource}
      transport={netgetMonadTransportOrigin()}
      resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
      document={netgetDocumentFor(entry.kind)}
      pages={NETGET_PAGES}
      hideBarItems={entry.hideBarItems}
      semanticPath={entry.semanticPath}
    />
  );
  return (
    <LauncherPopoverProvider>
      <Me>
        {entry.isMainServerDoor ? <DoorRouter>{shell}</DoorRouter> : shell}
      </Me>
    </LauncherPopoverProvider>
  );
}

// One composed entry for every door. The only other surface is local.host: this machine's own hardware/activity dashboard
// (HostSurface -- CPU/RAM/storage gauges, self-reported, not verified by the mesh, plus a live request feed), pointed at
// netget's own monad. It is a different surface, not a different composition of this app.
const ROLE = frontendRole({ host: HOST_NAME, boot: PROVIDER_BOOT });

const App = () => (
  ROLE === 'host' ? (
    <SeedSessionProvider
      transportOrigin={netgetMonadTransportOrigin()}
      resolveSeedFromCredentials={resolveNetgetSeedFromCredentials}
      sessionBackend="cleaker"
    >
      <LauncherPopoverProvider>
        <HostSurface endpoint={netgetMonadTransportOrigin()} />
      </LauncherPopoverProvider>
    </SeedSessionProvider>
  ) : (
    <EntryApp />
  )
);

export default App;
