/**
 * gatewayClaimsRefresh.ts -- the deploy kit's checked rebuild of gateway-claims.json.
 *
 * The cache Lua and netget's admin sessions read is only ever a copy of the canonical gateway-authority record held by
 * this gateway's OWN monad. After an upgrade that adds a field the sessions now require (the anchored `namespaces`),
 * the operator rebuilds it from there -- never from a surface some request named, and without starting a monad.
 */
import { GatewayClaimsManager, getGatewayClaimsPath } from './GatewayClaimsManager.js';
import { getNetgetMonadStatus } from '../../../kernel/netgetMonadProcess.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function loopbackOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`not an http(s) origin: ${raw}`);
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error(`the gateway's own monad is reached on loopback only, not ${url.hostname}`);
  return url.origin;
}

/** `explicit` (--origin) or NETGET_MONAD_ORIGIN, else the running netget monad's own record. Never starts one. */
export async function resolveGatewayAuthorityOrigin(explicit?: string): Promise<string> {
  const given = String(explicit || process.env.NETGET_MONAD_ORIGIN || '').trim();
  if (given) return loopbackOrigin(given);
  const status = await getNetgetMonadStatus();
  if (!status.running || !status.origin) throw new Error("netget's own monad is not running; start it first (nothing was changed)");
  return loopbackOrigin(status.origin);
}

/** The gateway this cache belongs to: the one already cached, else this host's default. */
function cachedGatewayId(): string | undefined {
  const current = new GatewayClaimsManager(undefined, { ledger: false }).read();
  return current?.gatewayId || undefined;
}

export async function refreshGatewayClaims(
  origin: string,
  options: { acceptOwnerChange?: boolean; gatewayId?: string } = {},
): Promise<{ ok: true; summary: string[] } | { ok: false; error: string }> {
  const mgr = new GatewayClaimsManager(options.gatewayId ?? cachedGatewayId(), { ledger: false });
  const result = await mgr.refreshFromGatewayAuthority(origin, { acceptOwnerChange: options.acceptOwnerChange });
  if (!result.ok) return result;
  const { snapshot, previous } = result;
  const owner = String(snapshot.owner || '');
  return {
    ok: true,
    summary: [
      `gateway:   ${snapshot.gatewayId}`,
      `from:      ${origin}`,
      `owner:     ${owner.slice(0, 12)}…  anchored at ${snapshot.namespaces?.[owner] ?? '(none)'}`,
      `admins:    ${Object.keys(snapshot.admins).length}, all bound to a namespace`,
      `version:   ${previous?.version ?? '(no cache)'} -> ${snapshot.version}`,
      `file:      ${getGatewayClaimsPath()}`,
    ],
  };
}
