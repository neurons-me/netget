// appsProjection.mjs -- what an anonymous visitor may read about the apps registered on this gateway.
//
// GET /apps is a public route (adminGate.mjs PUBLIC_ROUTES): the monad page and the dashboard show anyone which
// monads are live here. A registry entry, though, carries the machine's own wiring: the loopback port and URL, the
// process id, the working directory (the release path), the exposure policy, tags, the claimed namespaces. Found live
// 2026-11-05: cleaker.me/apps answered all of it to anyone, while netget.site/apps (apps.lua, local-only) answered 403
// -- the same registry, two answers, decided by the door.
//
// So the public answer is built from an explicit allow-list, field by field, as /domains does
// (domainsProjection.mjs). A field added to the entry later is not public until someone adds it here: the default is
// out, not in. The full entry is what the machine's own processes (apps.lua, the registry file) and an authorized
// admin session get.

/** The only fields of a registry entry that leave on an anonymous answer. */
export const PUBLIC_APP_FIELDS = Object.freeze(['name', 'kind', 'trust', 'status', 'lastSeenMs', 'ttlMs']);

/** One entry, as an anonymous visitor sees it: the allow-listed fields, nothing else. */
export function publicAppView(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  const out = {};
  for (const key of PUBLIC_APP_FIELDS) {
    const value = src[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}
