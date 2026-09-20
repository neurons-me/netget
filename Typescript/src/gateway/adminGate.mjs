// adminGate.mjs -- who may use the gateway's routes once they are the monad's routes.
//
// The gateway's Express routes were written for a perimeter: nginx verified a signature
// in Lua and set identity headers, and "loopback" meant the operator. Mounted in a
// monad that a reverse proxy fronts, neither holds -- every request arrives from
// 127.0.0.1 and any header can be sent by anyone. Some of those routes change what the
// gateway is (POST /add-domain, /openresty-stop, /__gateway/claim, which makes the
// caller the owner of a gateway that has none). So the module decides for itself, by
// the route and not by where the request seems to come from:
//
//   public    read-only, and what an anonymous visitor is meant to see;
//   own       routes that authenticate their own request (signed setup, admin-session
//             challenge, gateway-admin, /logs with its bearer);
//   trusted   everything else: the machine's own callers (the internal token), or a
//             verified admin session with the gateway:write capability.
//
// The route table is read from the routers themselves, so a route added later is
// `trusted` until someone lists it as public. Paths that are not gateway routes (the
// monad's own, the tree) are not touched.
//
// The identity headers that the old perimeter set (x-netget-identity / x-netget-scopes)
// are honored only from an internal caller; for a session they are set here from the
// session, never taken from the request.

import { isInternalRequest } from 'monad.ai';

export const PUBLIC_ROUTES = new Set([
  'GET /gateway-identity',
  'GET /main-server-namespace',
  'GET /domains',
  'GET /domains/:parent/subdomains',
  'GET /healthcheck',
  'GET /ip-info',
  'GET /port-info',
  'GET /cleaker/resolve',
  'GET /apps',
  'GET /openresty-status',
  'GET /frontend-mode',
  'GET /apps/:name/frontend-mode',
]);

// Routes that verify their own request and must stay reachable without a session.
export const OWN_AUTH_ROUTES = [
  /^POST \/setup\//,
  /^POST \/admin-session\//,
  /^POST \/gateway-admin\//,
  /^GET \/logs$/,
];

export const WRITE_SCOPE = 'gateway:write';

export function classifyRoute(method, routePath) {
  const key = `${method} ${routePath}`;
  if (PUBLIC_ROUTES.has(key)) return 'public';
  if (OWN_AUTH_ROUTES.some((re) => re.test(key))) return 'own';
  return 'trusted';
}

/** The (method, path pattern) of every route the routers define, with a matcher. */
export function routeTableOf(routers) {
  const table = [];
  for (const router of routers) {
    for (const layer of router.stack ?? []) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods ?? {})) {
        if (!layer.route.methods[method]) continue;
        table.push({ method: method.toUpperCase(), path: String(layer.route.path), match: (p) => layer.match(p) });
      }
    }
  }
  return table;
}

function bearerOf(req) {
  const header = String(req.headers?.authorization || '');
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/**
 * resolveSession(token) -> { identityHash, scopes } | null     (adminSession.ts)
 * isOwner(identityHash) -> boolean                              (GatewayClaimsManager)
 */
export function gatewayAdminGate(routers, { resolveSession, isOwner } = {}) {
  const table = routeTableOf(routers);
  return async (req, res, next) => {
    const path = req.path;
    const method = String(req.method).toUpperCase();
    const route = table.find((r) => r.method === method && r.match(path));
    // Not one of the gateway's routes (the monad's own, the tree): not decided here.
    if (!route) return next();

    const policy = classifyRoute(method, route.path);
    if (policy === 'public' || policy === 'own') {
      if (!isInternalRequest(req)) {
        delete req.headers['x-netget-identity'];
        delete req.headers['x-netget-scopes'];
      }
      return next();
    }

    if (isInternalRequest(req)) return next();

    const token = bearerOf(req);
    if (token && resolveSession) {
      let session = null;
      try {
        session = await resolveSession(token);
      } catch {
        session = null;
      }
      if (session) {
        const owner = Boolean(isOwner?.(session.identityHash));
        const scopes = new Set(session.scopes ?? []);
        if (owner) scopes.add(WRITE_SCOPE);
        if (scopes.has(WRITE_SCOPE)) {
          req.headers['x-netget-identity'] = session.identityHash;
          req.headers['x-netget-scopes'] = JSON.stringify([...scopes]);
          return next();
        }
        return res.status(403).json({ ok: false, error: 'CAPABILITY_DENIED', required: WRITE_SCOPE });
      }
    }

    delete req.headers['x-netget-identity'];
    delete req.headers['x-netget-scopes'];
    return res.status(401).json({ ok: false, error: 'ADMIN_SESSION_REQUIRED' });
  };
}
