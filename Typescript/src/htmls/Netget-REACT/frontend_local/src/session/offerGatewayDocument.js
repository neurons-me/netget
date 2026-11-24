// Whether netget's document (the gateway branch at /netget) should be offered.
//
// The door does not decide this. The visitor sees the namespace itself (Storybook
// example 1). The owner, at the /netget pointer, sees the gateway panel
// (NETGET_DOCUMENT: Dashboard, Domains, Logs, …). Ownership is the existing
// gateway:admin check (signed /check-auth isOwner/isAdmin, or a stored admin session).
import { GATEWAY_ADMIN } from './gatewayCapabilities.js';

const clean = (p) => {
  const s = String(p == null ? '' : p);
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s || '/';
};

/** Routes that belong to the /netget pointer (the gateway branch), plus /netget itself. */
export const GATEWAY_BRANCH_ROUTES = Object.freeze([
  '/netget',
  '/home',
  '/domains',
  '/logs',
  '/monad',
  '/apps',
  '/terms-and-conditions',
  '/privacy-policy',
]);

/**
 * Is this the /netget pointer?
 * The main server's door (netget.site) enters there, whatever the address bar shows
 * ("/" on that door is /netget). On any other door, only the gateway branch's paths count.
 */
export function atGatewayPointer({ entry, pathname }) {
  if (entry && entry.isMainServerDoor) return true;
  const path = clean(pathname);
  return GATEWAY_BRANCH_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * Should the shell be given NETGET_DOCUMENT?
 * Fail closed: not at the pointer, or the existing admin check does not pass, or the check throws.
 *
 * @param {{ session: object|null, entry: object, pathname: string, resolvers: object, scope?: string, signal?: AbortSignal }} input
 * @returns {Promise<boolean>}
 */
export async function offerGatewayDocument({ session, entry, pathname, resolvers, scope, signal }) {
  if (!atGatewayPointer({ entry, pathname })) return false;
  const resolve = resolvers && resolvers[GATEWAY_ADMIN];
  if (typeof resolve !== 'function') return false;
  try {
    return Boolean(await resolve({
      session: session || { authenticated: false, me: null },
      scope,
      signal,
    }));
  } catch {
    return false;
  }
}
