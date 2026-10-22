// What ONE entry composes, from the context that was resolved. Pure: no React, no window, no network.
//
// The page used to pick between two apps by the hostname (providerBoot.js frontendRole: a namespace's own hosts got the
// bare Namespace landing, every other host got the Cleaker shell with netget's document), so cleaker.me and localhost
// showed different sidebars for the same bundle. Now every door mounts the same shell. The address contributes CONTEXT
// (which namespace the monad or the gateway declared, where it is reached); the document is composed from that context:
//
//   namespace  a namespace's own door (cleaker.me, www, a handle): the monad handed this page its namespace.
//   gateway    any other door (netget.site, localhost, whatever nginx serves statically): the gateway's own screens.
//   host       local.host: this machine's own dashboard, a different surface that is not a composition of this app.
//
// What each composes:
//   * Monad: every door. A monad is identified behind it; the shell dims the link when that monad is off.
//   * Dashboard, Domains, Logs, Apps: the gateway's screens, only where the resolved context is a gateway door. Domains and
//     Logs also stay `requires: 'session'` (it hides a link until someone signed in: it authorizes nothing). What a
//     session may do there is decided by the server, per request.
//   * Terms and Privacy: every door.
import { frontendRole, rootNamespaceOf, mainServerDoor } from './providerBoot.js';

export const ENTRY_KINDS = Object.freeze(['namespace', 'gateway', 'host']);

const lower = (value) => String(value || '').trim().toLowerCase();

/**
 * @param {{ host: string, boot: object|null, declared: object|null, pathname: string }} input
 *   `boot`: what the monad that served the page said (window.__MONAD_NAMESPACE_PROVIDER_BOOT__), or null.
 *   `declared`: what the gateway says (/main-server-namespace), or null when it did not answer.
 */
export function resolveEntry({ host, boot, declared, pathname }) {
  const role = frontendRole({ host, boot });
  if (role === 'host') return { kind: 'host' };
  if (role === 'cleaker') {
    // The monad said which namespace this page links to: its root (a handle's own namespace is never composed from the
    // handle: that made jabellae.jabellae.cleaker.me). With no monad at all (local.cleaker) the address is only a draft.
    const root = rootNamespaceOf(boot);
    return {
      kind: 'namespace',
      namespace: root || lower(host),
      namespaceSource: root ? 'declared' : 'address',
      isMainServerDoor: false,
      canonicalPath: null,
      semanticPath: '/',
      hideBarItems: ['url', 'dashboard'],
    };
  }
  const door = mainServerDoor({ host, declared, pathname });
  return {
    kind: 'gateway',
    namespace: door.namespace,
    namespaceSource: door.isMainServerDoor ? 'declared' : 'address',
    isMainServerDoor: door.isMainServerDoor,
    canonicalPath: door.canonicalPath,
    // Where the position label points inside the namespace. Only what a door DECLARES counts: the main server's door is
    // the namespace's `netget` node; everywhere else the label is the namespace's root.
    semanticPath: door.isMainServerDoor ? '/netget' : '/',
    // Dashboard and URL are not in the rail for now. The main server's own door is netget's app, not the namespace, so its
    // directory views (Users, Blockchain) are not this app's navigation either. Icons only: the pages and routes remain.
    hideBarItems: door.isMainServerDoor ? ['users', 'blockchain', 'url', 'dashboard'] : ['url', 'dashboard'],
  };
}

/** Whether resolving this door needs the gateway's declaration (/main-server-namespace): a namespace door was already told. */
export function needsDeclaration({ host, boot }) {
  return frontendRole({ host, boot }) === 'gateway';
}

// ── the document ───────────────────────────────────────────────────────────────────────────────────────────────────
// Same routes the standalone shell served, so links and bookmarks hold. `needs`: the layer behind this door the page
// cannot work without; when it is off the shell shows the layers panel in its place and dims the sidebar link.
const LEFT = {
  dashboard: { label: 'Dashboard', to: '/home', icon: 'dashboard', placement: 'end' },
  domains: { label: 'Domains', to: '/domains', icon: 'language', requires: 'session', placement: 'end' },
  logs: { label: 'Logs', to: '/logs', icon: 'article', requires: 'session', placement: 'end' },
  // the monad.ai orb, the same one the Monad surface draws (not a generic chip icon)
  monad: { label: 'Monad', to: '/monad', icon: 'orb:monad', placement: 'end' },
};

const CONTENT = {
  dashboard: { label: 'Dashboard', component: 'NetgetDashboard', route: '/home', needs: 'backend', note: 'Gateway status (REST: /gateway-identity, /apps).' },
  domains: { label: 'Domains', component: 'NetgetDomains', route: '/domains', needs: 'both', note: 'Domain routing CRUD (REST, stored through the monad).' },
  logs: { label: 'Logs', component: 'NetgetLogs', route: '/logs', needs: 'backend', note: 'Nginx log viewer (REST).' },
  monad: { label: 'Monad', component: 'NetgetMonad', route: '/monad', needs: 'monad', note: "This netget's own monad: the surface it reports." },
  // The server answers /apps with this page to a browser and with the registry (JSON) to a program.
  apps: { label: 'Apps', component: 'NetgetDashboard', route: '/apps', needs: 'backend', note: 'The apps registered on this host (same view as the dashboard).' },
  terms: { label: 'Terms', component: 'NetgetTerms', route: '/terms-and-conditions' },
  privacy: { label: 'Privacy', component: 'NetgetPrivacy', route: '/privacy-policy' },
};

const pick = (source, ids) => Object.fromEntries(ids.map((id) => [id, source[id]]));

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const compose = (leftIds, contentIds) => deepFreeze({
  GUI: { children: { bars: { children: { left: { children: pick(LEFT, leftIds) } } }, content: { children: pick(CONTENT, contentIds) } } },
});

// One object per kind, created once: the shell memoizes on the document it is given, so a new object per render would
// recompose (and re-register) forever.
const DOCUMENTS = {
  namespace: compose(['monad'], ['monad', 'terms', 'privacy']),
  gateway: compose(['dashboard', 'domains', 'logs', 'monad'], ['dashboard', 'domains', 'logs', 'monad', 'apps', 'terms', 'privacy']),
};

export function netgetDocumentFor(kind) {
  const doc = DOCUMENTS[kind];
  if (!doc) throw new Error(`no document for entry kind "${kind}"`);
  return doc;
}
