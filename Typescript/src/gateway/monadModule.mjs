// monadModule.mjs -- the gateway, as a package a monad mounts.
//
// netget's admin API (setup and claim, domains, admin sessions, OpenResty
// install and status, gateway admin) used to be its own Express process on
// :3000 that also started a second monad of its own. A monad already is the
// runtime that is running, so the gateway now lives in it:
//
//   monads env local MONAD_MODULES=netget/gateway
//
// and the monad imports this file, which calls mount(app, ctx). One process,
// one port. Nothing here starts a monad: the one hosting this module IS the
// gateway's monad, and the routes reach it as themselves.
//
// The routes are TypeScript-importing JavaScript that netget has always run
// through tsx, so this registers tsx's loader first; that keeps the monad's own
// build plain JavaScript.
//
// It runs from the monorepo checkout (netget resolves to modules/netget there):
// the published package deliberately does not carry src/htmls/Netget-REACT
// (package-files test), and the routes live under it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayAdminGate } from './adminGate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = path.resolve(here, '../htmls/Netget-REACT/backend/routes');

// The gateway's routers, in the order the standalone backend mounted them.
export const GATEWAY_ROUTERS = [
  'setupSession.js',
  'localNetget.js',
  'openRestyInstall.js',
  'adminSession.js',
  'gatewayAdmin.js',
];

// Paths the monad answers itself. The standalone backend forwarded these to
// "its" monad; here the monad is the one being asked, so its own handler must
// stay the answer.
export const MONAD_OWN_PATHS = new Set(['/explain', '/inspect']);

// Same origins the standalone backend allowed for cross-origin browser calls
// (local.cleaker signs an admin session against local.netget), plus this
// request's own host, plus whatever NETGET_GATEWAY_ORIGINS adds
// (comma-separated hosts, e.g. "cleaker.me").
const LOCAL_ORIGIN = /(^|\.)local\.netget$|(^|\.)local\.cleaker$|^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/;

function firstValue(value) {
  return String(value ?? '').split(',')[0].trim().toLowerCase();
}

export function isAllowedOrigin(origin, req, extraHosts = []) {
  if (!origin) return true; // not a browser cross-origin call
  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const own = [firstValue(req.headers?.host), firstValue(req.headers?.['x-forwarded-host'])].filter(Boolean);
  if (own.includes(host)) return true;
  if (LOCAL_ORIGIN.test(host)) return true;
  return extraHosts.some((extra) => extra && (host === extra || host === `www.${extra}`));
}

/** Refuses a browser call from an origin that is not this host, local, or listed. */
export function originGuard(extraHosts = []) {
  return (req, res, next) => {
    if (isAllowedOrigin(req.headers?.origin, req, extraHosts)) return next();
    return res.status(403).json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
  };
}

/** Hands a request to `handler` unless the monad answers that path itself. */
export function delegateExcept(handler, ownPaths = MONAD_OWN_PATHS) {
  return (req, res, next) => (ownPaths.has(req.path) ? next() : handler(req, res, next));
}

export function parseHostList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, ''))
    .filter(Boolean);
}

/**
 * Mounts already-loaded routers on `app` behind the origin guard and the admin gate
 * (adminGate.mjs: who may use which route). Pure: no loading, no env.
 */
export function mountGatewayRouters(app, routers, options = {}) {
  const guard = originGuard(options.extraOrigins ?? []);
  const gate = gatewayAdminGate(routers, { resolveSession: options.resolveSession, isOwner: options.isOwner });
  const ownPaths = options.ownPaths ?? MONAD_OWN_PATHS;
  app.use('/', guard, delegateExcept(gate, ownPaths));
  for (const router of routers) {
    app.use('/', guard, delegateExcept(router, ownPaths));
  }
}

async function loadRouters() {
  const { register } = await import('tsx/esm/api');
  register();
  const routers = [];
  for (const file of GATEWAY_ROUTERS) {
    const loaded = await import(path.join(ROUTES_DIR, file));
    if (typeof loaded.default !== 'function') throw new Error(`${file} exports no router`);
    routers.push(loaded.default);
  }
  return routers;
}

export async function mount(app, ctx) {
  // Who this gateway's monad is, for the routes that ask (they used to start
  // and look up "netget's own monad" by name).
  const env = process.env;
  env.NETGET_MONAD_NAME ||= env.MONAD_NAME || 'local';
  env.NETGET_MONAD_NAMESPACE ||= env.ME_NAMESPACE || '';
  env.NETGET_MONAD_ORIGIN ||= `http://127.0.0.1:${ctx?.config?.port ?? env.PORT ?? 8161}`;
  // The gateway's identity IS this monad's seed. netget derives its own from
  // NETGET_GATEWAY_SEED first, and otherwise from a ledger identity file that an
  // older installation may not have (it then falls back to a seed derived from
  // the hostname) -- so the seed the monad actually runs with is the one it uses.
  if (env.SEED) env.NETGET_GATEWAY_SEED ||= env.SEED;

  const routers = await loadRouters();
  const { loadGatewayRootNamespaceCache } = await import('../kernel/netgetMonadProcess.ts');
  await loadGatewayRootNamespaceCache();

  // The namespace this monad serves signs claims for the gateway from its own
  // pages (cleaker.me -> netget.site), so it may call the gateway cross-origin.
  const own = parseHostList(env.ME_NAMESPACE);
  const { resolveAdminSession } = await import('../modules/NetGetX/Auth/adminSession.ts');
  const { GatewayClaimsManager } = await import('../modules/NetGetX/Auth/GatewayClaimsManager.ts');
  mountGatewayRouters(app, routers, {
    extraOrigins: [...parseHostList(env.NETGET_GATEWAY_ORIGINS), ...own],
    resolveSession: (token) => resolveAdminSession(token),
    isOwner: (identityHash) => new GatewayClaimsManager().isOwner(identityHash),
  });
}

export default { mount };
