// doorConnections.ts -- the connections a door declares: "under this door, requests whose path is <prefix> (or under it)
// go to <target>", instead of to the door's main destination.
//
// A door is a domain record (domainStore). Its main destination (`type`/`target`: a monad by `app:<name>`, a
// `host:port`, a folder) answers everything the record does not carve out. A connection carves out one path prefix
// and sends it to a service of the app that is not a monad: FullTrailer's own server (`/api/fuel` -> 127.0.0.1:4000).
//
// WHO DECLARES: the operator, through netget (this record). An app may say which connections it needs; publishing
// one is the administrator's act. Nothing here reads a registration or an app's self-reported metadata.
//
// This module is the declaration-time check. surface_proxy.lua / monad_proxy.lua (lib/door_connections.lua) apply the
// same rules again when a request arrives, because domain-map.json is a file and a file is not an authority.
//
// Scope of THIS delivery, stated as restrictions and not as the shape of the model:
//   * the target is a loopback literal (`127.0.0.1`, or `localhost` which means it); a network destination is part
//     of the model but is not accepted yet;
//   * the path is preserved: the service sees the path the client used (minus the door's own mount, `/apps/<name>`);
//   * a connection never replaces a path the gateway or the monad own (RESERVED_PREFIXES), and a prefix that would
//     cover one of them (`/api` covers `/api/v1`) is refused too.

export interface DoorConnection {
  /** Path prefix, `/api/fuel`. Matches that path and its descendants (`/api/fuel/1`), never `/api/fuelAnything`. */
  prefix: string;
  /** `127.0.0.1:4000` (an `http://` form is accepted and normalized to this). */
  target: string;
}

export type DoorConnectionCheck =
  | { ok: true; connection: DoorConnection }
  | { ok: false; reason: string };

/** Paths the gateway or the monad answer. A connection may not sit on them or above them. */
export const RESERVED_PREFIXES: readonly string[] = Object.freeze([
  '/api/v1', '/claims', '/me', '/.me', '/.mesh', '/.monads', '/.well-known',
  '/apps', '/monads', '/domains', '/gateway-identity', '/setup', '/admin-session', '/main-server-namespace',
  '/openresty-status', '/openresty-restart', '/openresty-stop', '/frontend-mode', '/entrypoints', '/surfaces',
  '/add-domain', '/delete-domain', '/provision-cert', '/check-auth', '/explain', '/inspect', '/cleaker',
  '/ip-info', '/port-info', '/healthcheck', '/logs', '/resolve', '/__surface', '/__provider', '/__gateway',
  '/assets', '/health', '/status',
]);

/** Ports that belong to the gateway itself: nginx and netget's backend. Never a connection target. */
export const GATEWAY_RESERVED_PORTS: readonly number[] = Object.freeze([80, 443, 3000]);

export const MAX_CONNECTIONS_PER_DOOR = 16;
export const MAX_PREFIX_LENGTH = 128;

const PREFIX_CHARS = /^[A-Za-z0-9._~\-/]+$/;

export function prefixConflictsWithReserved(prefix: string): string | null {
  for (const reserved of RESERVED_PREFIXES) {
    if (prefix === reserved || prefix.startsWith(reserved + '/')) return reserved;      // on it or under it
    if (reserved.startsWith(prefix + '/')) return reserved;                              // above it
  }
  return null;
}

/**
 * One connection, checked and normalized. `deniedPorts` are ports that must not be targets besides the gateway's
 * own: the ports of the monads that are registered (a monad is reached by `app:<name>`, through the door's
 * selection, never by its port).
 */
export function checkDoorConnection(input: unknown, deniedPorts: Iterable<number> = []): DoorConnectionCheck {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'a connection is an object { prefix, target }' };
  const raw = input as Record<string, unknown>;

  const prefix = typeof raw.prefix === 'string' ? raw.prefix.trim() : '';
  if (!prefix.startsWith('/')) return { ok: false, reason: 'prefix must start with "/"' };
  if (prefix === '/') return { ok: false, reason: 'prefix "/" is the door itself: change its destination instead' };
  if (prefix.length > MAX_PREFIX_LENGTH) return { ok: false, reason: `prefix is longer than ${MAX_PREFIX_LENGTH}` };
  if (prefix.endsWith('/')) return { ok: false, reason: 'prefix must not end with "/" (it already matches what is under it)' };
  if (!PREFIX_CHARS.test(prefix)) return { ok: false, reason: 'prefix may only contain letters, digits and . _ ~ - /' };
  if (prefix.includes('//')) return { ok: false, reason: 'prefix has an empty segment' };
  if (prefix.split('/').some((segment) => segment === '.' || segment === '..')) {
    return { ok: false, reason: 'prefix must not contain "." or ".." segments' };
  }
  const reserved = prefixConflictsWithReserved(prefix);
  if (reserved) return { ok: false, reason: `prefix overlaps ${reserved}, which the gateway or the monad answer` };

  const target = typeof raw.target === 'string' ? raw.target.trim() : '';
  const match = /^(?:http:\/\/)?(127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(target);
  if (!match) {
    return { ok: false, reason: 'target must be a loopback address with a port: 127.0.0.1:<port> (this delivery accepts only that)' };
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, reason: 'target port must be 1024-65535' };
  if (GATEWAY_RESERVED_PORTS.includes(port)) return { ok: false, reason: `port ${port} belongs to the gateway` };
  for (const denied of deniedPorts) {
    if (denied === port) return { ok: false, reason: `port ${port} is a registered monad: route to it by app name, not by port` };
  }

  return { ok: true, connection: { prefix, target: `127.0.0.1:${port}` } };
}

/** The list of a door: each entry checked, no duplicate prefix, at most MAX_CONNECTIONS_PER_DOOR. */
export function checkDoorConnections(
  input: unknown,
  deniedPorts: Iterable<number> = [],
): { ok: true; connections: DoorConnection[] } | { ok: false; reason: string; index?: number } {
  if (!Array.isArray(input)) return { ok: false, reason: 'connections is a list' };
  if (input.length > MAX_CONNECTIONS_PER_DOOR) return { ok: false, reason: `at most ${MAX_CONNECTIONS_PER_DOOR} connections per door` };
  const denied = [...deniedPorts];
  const out: DoorConnection[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const checked = checkDoorConnection(input[index], denied);
    if (checked.ok === false) return { ok: false, reason: checked.reason, index };
    if (seen.has(checked.connection.prefix)) return { ok: false, reason: `prefix ${checked.connection.prefix} is declared twice`, index };
    seen.add(checked.connection.prefix);
    out.push(checked.connection);
  }
  return { ok: true, connections: out };
}

/**
 * Does `path` belong to `prefix`? `/api/fuel` and `/api/fuel/1` do; `/api/fuelAnything` and `/api` do not. `path`
 * is the request's path without the query, already normalized by the server (no `.`/`..`, no `//`).
 */
export function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

/** The connection that answers `path`: the longest matching prefix, or null (the door's main destination answers). */
export function matchDoorConnection(path: string, connections: readonly DoorConnection[]): DoorConnection | null {
  let best: DoorConnection | null = null;
  for (const connection of connections) {
    if (!pathMatchesPrefix(path, connection.prefix)) continue;
    if (!best || connection.prefix.length > best.prefix.length) best = connection;
  }
  return best;
}

/** What is stored in the domain record's `connections` field (a JSON string: the store writes scalars). */
export function serializeDoorConnections(connections: readonly DoorConnection[]): string {
  return JSON.stringify(connections.map((c) => ({ prefix: c.prefix, target: c.target })));
}

/** The stored string back to a list. An unreadable or invalid value is "no connections", never a partial list. */
export function parseStoredDoorConnections(stored: unknown, deniedPorts: Iterable<number> = []): DoorConnection[] {
  if (typeof stored !== 'string' || stored.trim() === '') return [];
  let value: unknown;
  try { value = JSON.parse(stored); } catch { return []; }
  const checked = checkDoorConnections(value, deniedPorts);
  return checked.ok ? checked.connections : [];
}
