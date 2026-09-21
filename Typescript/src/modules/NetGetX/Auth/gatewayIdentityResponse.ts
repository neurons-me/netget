/**
 * gatewayIdentityResponse.ts -- the ONE answer to GET /gateway-identity.
 *
 * There used to be two: the Express route (what the monad serves) and a Lua handler behind nginx, and they were
 * different contracts -- the Lua one had `ownerUsername`, `ip`, `port` and `scheme` (which the screens read) but
 * counted admins WITHOUT the owner and gave `updatedAt` as an ISO string; the Express one had `version` and
 * `updatedAt` in milliseconds, counted the owner, and had none of the first four. The same gateway reported
 * `adminCount: 0` through one door and `1` through another, and the screen fed by the Express route could not
 * name its owner. Now there is one builder, used by the route; nginx sends the request to it.
 *
 * Three names that are not the same thing: `gatewayId` (stable identity of the gateway), `hostname` (the machine's name,
 * which can change) and the domains it is reached through (not part of this answer).
 *
 * Reads the materialized claims snapshot (gateway-claims.json) -- never calls .me at runtime.
 */
import os from 'node:os';

export type GatewayClaimsSnapshot = {
  gatewayId?: string | null;
  owner?: string | null;
  admins?: Record<string, unknown> | null;
  grants?: Record<string, unknown> | null;
  usernames?: Record<string, unknown> | null;
  version?: string | null;
  updatedAt?: number | string | null;
} | null;

/** How THIS request reached the gateway (informational: what the screens show as "arrived via https:443"). */
export type Arrival = { scheme: 'http' | 'https'; port: number };

export type GatewayIdentityResponse = {
  /** the gateway's stable identity (what the claim is bound to); it does not change when the machine is renamed */
  gatewayId: string;
  /** the machine's own name, which CAN change; a different thing from gatewayId and from the domains it is reached by */
  hostname: string;
  bootstrapped: boolean;
  /** identityHash of the owner, or null while unclaimed */
  owner: string | null;
  /** the owner's username, resolved from the same snapshot; null when unclaimed or unknown */
  ownerUsername: string | null;
  /** number of admins, the owner included (the owner is an admin; the snapshot's `admins` lists it) */
  adminCount: number;
  /** the owner's grants */
  scopes: string[];
  version: string | null;
  /** when the snapshot was written, epoch milliseconds as stored */
  updatedAt: number | null;
  scheme: 'http' | 'https';
  port: number;
  /** this machine's first non-internal IPv4 address */
  ip: string | null;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export function buildGatewayIdentityResponse(
  claims: GatewayClaimsSnapshot,
  arrival: Arrival,
  machine: { hostname: string; ip: string | null },
): GatewayIdentityResponse {
  const owner = text(claims?.owner);
  const admins = claims?.admins && typeof claims.admins === 'object' ? Object.keys(claims.admins) : [];
  const grants = owner && claims?.grants && typeof claims.grants === 'object' ? (claims.grants as Record<string, unknown>)[owner] : null;
  const usernames = claims?.usernames && typeof claims.usernames === 'object' ? (claims.usernames as Record<string, unknown>) : null;
  const updated = Number(claims?.updatedAt);
  return {
    gatewayId: text(claims?.gatewayId) ?? machine.hostname,
    hostname: machine.hostname,
    bootstrapped: owner !== null,
    owner,
    ownerUsername: owner && usernames ? text(usernames[owner]) : null,
    adminCount: admins.length,
    scopes: Array.isArray(grants) ? grants.filter((s): s is string => typeof s === 'string') : [],
    version: text(claims?.version),
    updatedAt: Number.isFinite(updated) && updated > 0 ? updated : null,
    scheme: arrival.scheme,
    port: arrival.port,
    ip: machine.ip,
  };
}

const first = (value: unknown): string => String(Array.isArray(value) ? value[0] : value ?? '').split(',')[0].trim();

/** How the request arrived, from what the edge said (X-Forwarded-Proto / -Port), else from the request itself. */
export function arrivalOf(headers: Record<string, unknown>, requestProtocol: string): Arrival {
  const proto = first(headers['x-forwarded-proto']).toLowerCase() || String(requestProtocol || '').toLowerCase();
  const scheme: 'http' | 'https' = proto === 'https' ? 'https' : 'http';
  const forwardedPort = Number(first(headers['x-forwarded-port']));
  const hostPort = Number(first(headers['x-forwarded-host'] || headers.host).split(':')[1]);
  const port = [forwardedPort, hostPort].find((p) => Number.isInteger(p) && p > 0 && p < 65536) ?? (scheme === 'https' ? 443 : 80);
  return { scheme, port };
}

/** This machine's first non-internal IPv4 address (no shelling out to ifconfig). */
export function localIPv4(): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
    }
  }
  return null;
}
