// What ONE entry composes, from the context that was resolved. Pure: no React, no window, no network.
//
// The page used to pick between two apps by the hostname (providerBoot.js frontendRole: a namespace's own hosts got the bare
// Namespace landing, every other host got the Cleaker shell with netget's document), and later still composed two DIFFERENT documents
// by door. Now every door mounts the same shell with the SAME document. The address contributes CONTEXT only:
//
//   * which namespace the monad or the gateway declared, and where it is reached (resolveEntry),
//   * how this door presents itself (which rail icons it leaves out, which node its position label points at).
//
// What the app OFFERS is declared once, in NETGET_DOCUMENT. What a person can USE is decided by the shell from the SELECTED link and
// the permissions it grants: Domains and Logs declare `requires: { capability }` (gateway:admin, gateway:logs), resolved for the selected
// gateway with the session through the selected link (session/gatewayCapabilities.js). So an administrator reaches them from any door
// that points at a gateway she administers, and nobody does merely by having signed in or by the door they came through. The gateway
// still authorizes every request.
//
//   namespace  a namespace's own door (cleaker.me, www, a handle): the monad handed this page its namespace.
//   gateway    any other door (netget.site, localhost, whatever nginx serves statically).
//   host       local.host: this machine's own dashboard, a different surface that is not a composition of this app.
import { frontendRole, rootNamespaceOf, mainServerDoor } from './providerBoot.js';
import { GATEWAY_ADMIN, GATEWAY_LOGS } from './gatewayCapabilities.js';

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
// Same routes the standalone shell served, so links and bookmarks hold. `needs`: the layer behind this door the page cannot work without;
// when it is off the shell shows the layers panel in its place and dims the sidebar link. `requires`: what the selected link must grant
// before the part is offered (the same declaration on the link and on the page behind its route).
const ADMIN = { capability: GATEWAY_ADMIN };
const LOGS = { capability: GATEWAY_LOGS };

const LEFT = {
  dashboard: { label: 'Dashboard', to: '/home', icon: 'dashboard', placement: 'end' },
  domains: { label: 'Domains', to: '/domains', icon: 'language', requires: ADMIN, placement: 'end' },
  logs: { label: 'Logs', to: '/logs', icon: 'article', requires: LOGS, placement: 'end' },
  // the monad.ai orb, the same one the Monad surface draws (not a generic chip icon)
  monad: { label: 'Monad', to: '/monad', icon: 'orb:monad', placement: 'end' },
};

const CONTENT = {
  dashboard: { label: 'Dashboard', component: 'NetgetDashboard', route: '/home', needs: 'backend', note: 'Gateway status (REST: /gateway-identity, /apps).' },
  domains: { label: 'Domains', component: 'NetgetDomains', route: '/domains', needs: 'both', requires: ADMIN, note: 'Domain routing CRUD (REST, stored through the monad).' },
  logs: { label: 'Logs', component: 'NetgetLogs', route: '/logs', needs: 'backend', requires: LOGS, note: 'Nginx log viewer (REST).' },
  monad: { label: 'Monad', component: 'NetgetMonad', route: '/monad', needs: 'monad', note: "This netget's own monad: the surface it reports." },
  // The server answers /apps with this page to a browser and with the registry (JSON) to a program.
  apps: { label: 'Apps', component: 'NetgetDashboard', route: '/apps', needs: 'backend', note: 'The apps registered on this host (same view as the dashboard).' },
  terms: { label: 'Terms', component: 'NetgetTerms', route: '/terms-and-conditions' },
  privacy: { label: 'Privacy', component: 'NetgetPrivacy', route: '/privacy-policy' },
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// One object, created once: the shell memoizes on the document it is given, so a new object per render would recompose (and
// re-register) forever.
export const NETGET_DOCUMENT = deepFreeze({
  GUI: { children: { bars: { children: { left: { children: LEFT } } }, content: { children: CONTENT } } },
});
