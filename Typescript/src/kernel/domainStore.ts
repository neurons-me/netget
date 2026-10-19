/**
 * domainStore.ts
 *
 * Domain registry backed by netget's own monad (see netgetMonadProcess.ts —
 * netget spawns and supervises a real, generic `modules/monad/Typescript`
 * daemon instead of embedding a private `.me` kernel directly in this
 * process). Same public API as before this migration, so callers are
 * unaffected.
 *
 * Storage layout in the kernel (via the monad's semantic write/read surface,
 * `POST /` and `GET /<path>`, monadHttpClient.ts):
 *
 *   users.<owner>.domains["example.com"].target      → routing target
 *   users.<owner>.domains["example.com"].type         → "proxy" | "static" | "server"
 *   users.<owner>.domains["example.com"].owner         → owner string (redundant
 *     with the namespace itself, kept for record completeness/back-compat)
 *   ...(see DOMAIN_FIELDS below for the full field list)
 *
 * Every domain is written under its OWNER's namespace (`users.<owner>.*`) —
 * this is how the generic monad write path (`namespaceToKernelPrefix`)
 * already works; there's no way to opt out of it, and the user confirmed in
 * conversation this is actually the right shape: it sections domains by who
 * manages them for free. Domains without an explicit owner fall back to the
 * `netget` identity itself (`users.netget.*`).
 *
 * Because per-owner data has no single "list everything" primitive, a small
 * index is maintained alongside it at `users.netget.domainIndex.<key> =
 * {owner}` — getDomains() reads this index first, then reads each domain's
 * full record from its owner's namespace.
 *
 * Persistence is automatic: the monad's `POST /` handler calls
 * `saveSnapshot()` itself after every write (see modules/monad's
 * commandHandler.ts) — this module never needs to explicitly persist.
 */

import { parseStoredDoorConnections, checkDoorConnections, serializeDoorConnections, type DoorConnection } from '../runtime/doorConnections.js';
import { registeredMonadPorts } from '../runtime/doorConnectionPorts.js';
import { checkRouteTarget } from '../runtime/routeTargets.js';
import { isValidDomainPattern , appNameOfTarget, identityBoundTo, WildcardBindingError } from '../runtime/authorizedRoots.js';
import { getNetgetMonadOrigin, getGatewayRootNamespace } from './netgetMonadProcess.js';
import { writeToMonad, readFromMonad } from './monadHttpClient.js';

// ── Types (unchanged — same public shape as before this migration) ─────────

export interface DomainRecord {
  domain: string;
  subdomain?: string;
  email?: string;
  sslMode?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
  target?: string;
  type?: string;
  projectPath?: string;
  rootDomain?: string;
  owner?: string;
  nginxConfig?: string;
  dnsProvider?: string;
  /**
   * Connections the operator declared on this door: a path prefix that belongs to a service of the app which is not
   * its monad (FullTrailer's own server at `/api/fuel`). Stored as a JSON string (the store writes scalars) and
   * returned here already parsed and checked; an invalid stored value reads as none. See runtime/doorConnections.ts.
   */
  connections?: DoorConnection[];
  /**
   * For a wildcard route (`*.<name>`) to `app:<name>`: the identity of the app the OPERATOR bound it to when declaring
   * it. The router serves the route only from a registration that carries it (surface_proxy.lua).
   */
  identity?: string;
  /** Absolute kernel path for this record (`users.<owner>.domains.<key>`,
   * dots in the domain name escaped) — lets a GUI node's `provenance` point
   * Explain/Inspect straight at the real value, computed once here so
   * frontend code never needs to re-derive netget's owner/escaping
   * convention itself. See escapeDomainKey/sanitizeOwnerLabel below. */
  semanticPath?: string;
}

export interface DomainConfigResult {
  domain: string;
  type: string;
  port?: number;
  sslCertificate?: string;
  target: string;
}

// ── Owner / namespace helpers ───────────────────────────────────────────────

const NETGET_OWNER_FALLBACK = 'netget';

const DOMAIN_FIELDS = [
  'target', 'type', 'subdomain', 'email', 'sslMode', 'sslCertificate',
  'sslCertificateKey', 'projectPath', 'rootDomain', 'owner', 'nginxConfig',
  'dnsProvider', 'registered', 'connections', 'identity',
] as const;
type DomainField = typeof DOMAIN_FIELDS[number];

function domainKey(domain: string): string {
  return domain.toLowerCase().trim();
}

/**
 * The monad's write/read wire protocol takes `expression`/path as a plain
 * string and splits it on `.` to build/walk a nested tree (see modules/monad's
 * memoryStore.ts setDeepValue/getDeepValue) — there's no bracket/proxy escape
 * hatch like the old embedded-kernel version of this file used
 * (`me.domains[key].field`, which bypassed path-string parsing entirely).
 * A real domain name contains dots ("example.com"), so it can't be used
 * verbatim as one path segment — confirmed by testing: writing
 * `domains.example.com.target` silently splits into 4 nested levels
 * instead of one domain key with a `target` field. Escape dots before using
 * a key in any expression/path string sent over the wire; unescape when
 * reading a key back out of an index.
 */
function escapeDomainKey(key: string): string {
  return key.replace(/\./g, '__DOT__');
}

function unescapeDomainKey(escaped: string): string {
  return escaped.replace(/__DOT__/g, '.');
}

export function sanitizeOwnerLabel(raw: string | undefined): string {
  const safe = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return safe || NETGET_OWNER_FALLBACK;
}

function ownerNamespace(owner: string): string {
  return `${sanitizeOwnerLabel(owner)}.${getGatewayRootNamespace()}`;
}

function indexNamespace(): string {
  return ownerNamespace(NETGET_OWNER_FALLBACK);
}

async function writeField(owner: string, key: string, field: DomainField, value: unknown): Promise<void> {
  if (value === undefined) return;
  await writeToMonad(await getNetgetMonadOrigin(), ownerNamespace(owner), `domains.${escapeDomainKey(key)}.${field}`, value);
}

async function writeDefinedFields(owner: string, key: string, fields: Partial<Record<DomainField, unknown>>): Promise<void> {
  await Promise.all(
    (Object.entries(fields) as [DomainField, unknown][])
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => writeField(owner, key, field, value)),
  );
}

type DomainIndex = Record<string, { owner?: string }>;

async function readIndex(): Promise<DomainIndex> {
  const { value } = await readFromMonad<Record<string, { owner?: string }>>(await getNetgetMonadOrigin(), indexNamespace(), 'domainIndex');
  if (!value || typeof value !== 'object') return {};
  const out: DomainIndex = {};
  for (const [escapedKey, entry] of Object.entries(value)) {
    out[unescapeDomainKey(escapedKey)] = entry;
  }
  return out;
}

async function writeIndexEntry(key: string, owner: string): Promise<void> {
  await writeToMonad(await getNetgetMonadOrigin(), indexNamespace(), `domainIndex.${escapeDomainKey(key)}`, { owner });
}

async function deleteIndexEntry(key: string): Promise<void> {
  // value is a placeholder, never read back — operator:'-' is what tombstones
  // this path on later branch reads; the underlying kernel write rejects a
  // null/undefined body outright, so this can't be `null`.
  await writeToMonad(await getNetgetMonadOrigin(), indexNamespace(), `domainIndex.${escapeDomainKey(key)}`, true, '-');
}

async function resolveOwnerForKey(key: string): Promise<string | undefined> {
  const index = await readIndex();
  return index[key]?.owner;
}

async function readRecordBranch(owner: string, key: string): Promise<Partial<Record<DomainField, unknown>> | undefined> {
  const { value } = await readFromMonad<Record<string, unknown>>(await getNetgetMonadOrigin(), ownerNamespace(owner), `domains.${escapeDomainKey(key)}`);
  return (value && typeof value === 'object') ? value as Partial<Record<DomainField, unknown>> : undefined;
}

function toDomainRecord(key: string, owner: string, branch: Partial<Record<DomainField, unknown>>): DomainRecord {
  return {
    domain: key,
    target: branch.target as string | undefined,
    type: branch.type as string | undefined,
    subdomain: branch.subdomain as string | undefined,
    email: branch.email as string | undefined,
    sslMode: branch.sslMode as string | undefined,
    sslCertificate: branch.sslCertificate as string | undefined,
    sslCertificateKey: branch.sslCertificateKey as string | undefined,
    projectPath: branch.projectPath as string | undefined,
    rootDomain: branch.rootDomain as string | undefined,
    owner: branch.owner as string | undefined,
    nginxConfig: branch.nginxConfig as string | undefined,
    dnsProvider: branch.dnsProvider as string | undefined,
    connections: parseStoredDoorConnections(branch.connections, registeredMonadPorts()),
    identity: (typeof branch.identity === 'string' && branch.identity) ? branch.identity : undefined,
    semanticPath: `users.${sanitizeOwnerLabel(owner)}.domains.${escapeDomainKey(key)}`,
  };
}

async function regenerateMap(): Promise<void> {
  try {
    const { generateDomainMap } = await import('../runtime/domainMap.js');
    await generateDomainMap();
  } catch {
    // non-fatal
  }
}

/**
 * A route is written through several doors (the panel's /add-domain and /update-domain, `netget routing`, setup flows).
 * The protections on what it may point at live HERE, in the store, so none of them depends on which door was used:
 * routeTargets.ts says what a static/server/proxy destination may be (a gateway port, a registered app's port and a
 * link-local address are refused). A record with no type, and the main server's own record, are not routing
 * destinations and pass unchanged; any other kind must be one the router supports.
 */
export class RouteTargetError extends Error {
  readonly code: string;
  constructor(code: string, reason: string) {
    super(reason);
    this.name = 'RouteTargetError';
    this.code = code;
  }
}

function checkedRoute(type: string | undefined | null, target: string | undefined | null): { type?: string; target?: string } {
  const kind = String(type ?? '').trim().toLowerCase();
  // No type at all (registered, not routed yet) and the main server's own record are not routing destinations. Any other
  // kind must be one the router supports: an unknown type would otherwise be projected as a proxy and skip this check.
  if (kind === '' || kind === 'main_server') return { type: type ?? undefined, target: target ?? undefined };
  const checked = checkRouteTarget(kind, target ?? '', { registeredPorts: registeredMonadPorts() });
  if (checked.ok === false) throw new RouteTargetError(checked.code, checked.reason);
  return { type: checked.type, target: checked.target };
}


/**
 * What a wildcard route is bound to. Only a wildcard whose destination is an app has an identity; any other route has
 * none ('' clears a previous one). The same app, re-declared, keeps the identity it was bound to (changing a destination
 * is an act; re-sending the same one must not re-pin to whoever happens to be registered now).
 */
function wildcardIdentity(key: string, target: string | undefined, current?: { target?: unknown; identity?: unknown }): string | undefined {
  if (!key.startsWith('*.')) return undefined;
  const app = appNameOfTarget(target);
  if (!app) return '';
  const before = appNameOfTarget(typeof current?.target === 'string' ? current.target : undefined);
  if (before === app && typeof current?.identity === 'string' && current.identity) return current.identity;
  try {
    return identityBoundTo(app);
  } catch (error) {
    if (error instanceof WildcardBindingError) throw new RouteTargetError(error.code, error.message);
    throw error;
  }
}

// ── Public API (mirrors the pre-migration embedded-kernel version) ─────────

export async function registerDomain(
  domain: string,
  subdomain?: string,
  email?: string,
  sslMode?: string,
  sslCertificate?: string,
  sslCertificateKey?: string,
  target?: string,
  type?: string,
  projectPath?: string,
  owner?: string,
): Promise<void> {
  if (!isValidDomainPattern(domain)) {
    throw new RouteTargetError('WILDCARD_SHAPE', 'un comodín solo es válido como *.<nombre> (un solo * al inicio, luego etiquetas)');
  }
  const key = domainKey(domain);
  const existingOwner = await resolveOwnerForKey(key);
  if (existingOwner) throw new Error(`The domain ${domain} already exists.`);
  ({ type, target } = checkedRoute(type, target));
  const identity = wildcardIdentity(key, target);

  const resolvedOwner = sanitizeOwnerLabel(owner);
  await writeIndexEntry(key, resolvedOwner);
  await writeDefinedFields(resolvedOwner, key, {
    subdomain, email, sslMode, sslCertificate, sslCertificateKey,
    target, type, projectPath, owner: resolvedOwner, registered: true, identity,
  });

  await regenerateMap();
}

export async function getDomains(): Promise<DomainRecord[]> {
  const index = await readIndex();
  const entries = Object.entries(index);
  const records = await Promise.all(entries.map(async ([key, entry]) => {
    const owner = entry?.owner || NETGET_OWNER_FALLBACK;
    const branch = await readRecordBranch(owner, key);
    return branch ? toDomainRecord(key, owner, branch) : null;
  }));
  return records.filter((r): r is DomainRecord => r !== null);
}

export async function getDomainByName(domain: string): Promise<DomainRecord | undefined> {
  const key = domainKey(domain);
  const owner = await resolveOwnerForKey(key);
  if (!owner) return undefined;
  const branch = await readRecordBranch(owner, key);
  return branch ? toDomainRecord(key, owner, branch) : undefined;
}

export async function updateDomain(
  domain: string,
  subdomain?: string,
  email?: string,
  sslMode?: string,
  sslCertificate?: string,
  sslCertificateKey?: string,
  target?: string,
  type?: string,
  projectPath?: string,
  owner?: string,
): Promise<void> {
  const key = domainKey(domain);
  const currentOwner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  let identity: string | undefined;
  if (type !== undefined || target !== undefined) {
    const current = await readRecordBranch(currentOwner, key);
    ({ type, target } = checkedRoute(
      type !== undefined ? type : (current?.type as string | undefined),
      target !== undefined ? target : (current?.target as string | undefined),
    ));
    identity = wildcardIdentity(key, target, current);
  }
  // Reassigning `owner` moves this domain's *newly written* fields to the
  // new owner's namespace and updates the index. Fields not passed in this
  // call that already existed under the old owner are left there (a narrow,
  // accepted gap — full owner-reassignment migration isn't in scope here).
  const targetOwner = owner !== undefined ? sanitizeOwnerLabel(owner) : currentOwner;
  if (targetOwner !== currentOwner) {
    await writeIndexEntry(key, targetOwner);
  }

  await writeDefinedFields(targetOwner, key, {
    subdomain, email, sslMode, sslCertificate, sslCertificateKey,
    target, type, projectPath, owner: owner !== undefined ? targetOwner : undefined, identity,
  });
  await regenerateMap();
}

export async function updateDomainTarget(domain: string, target: string): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  const current = await readRecordBranch(owner, key);
  ({ target } = checkedRoute(current?.type as string | undefined, target) as { target: string });
  const identity = wildcardIdentity(key, target, current);
  await writeField(owner, key, 'target', target);
  await writeField(owner, key, 'identity', identity);
  await regenerateMap();
}

export async function updateDomainType(domain: string, type: string): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  const current = await readRecordBranch(owner, key);
  checkedRoute(type, current?.target as string | undefined);
  const identity = wildcardIdentity(key, current?.target as string | undefined, current);
  await writeField(owner, key, 'type', type);
  await writeField(owner, key, 'identity', identity);
  await regenerateMap();
}

export async function updateDomainRoute(
  domain: string,
  type: string | null,
  target: string | null,
): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  if (type !== null || target !== null) {
    const current = await readRecordBranch(owner, key);
    const checked = checkedRoute(
      type !== null ? type : (current?.type as string | undefined),
      target !== null ? target : (current?.target as string | undefined),
    );
    if (type !== null) type = checked.type ?? type;
    if (target !== null) target = checked.target ?? target;
  }
  if (type !== null || target !== null) {
    const current = await readRecordBranch(owner, key);
    const nextTarget = target !== null ? target : (current?.target as string | undefined);
    const identity = wildcardIdentity(key, nextTarget, current);
    if (identity !== undefined) await writeField(owner, key, 'identity', identity);
  }
  if (type !== null) await writeField(owner, key, 'type', type);
  if (target !== null) await writeField(owner, key, 'target', target);
  await regenerateMap();
}

/**
 * Declares the connections of a door (replaces the list). The operator's act: callers are the CLI and the gateway's
 * authorized admin routes, never an app's own registration. Throws, and writes nothing, when any entry is refused.
 */
export async function updateDomainConnections(domain: string, connections: unknown): Promise<DoorConnection[]> {
  const checked = checkDoorConnections(connections, registeredMonadPorts());
  if (checked.ok === false) {
    throw new Error(`connection${checked.index !== undefined ? ` #${checked.index + 1}` : 's'} refused: ${checked.reason}`);
  }
  const key = domainKey(domain);
  const owner = await resolveOwnerForKey(key);
  if (!owner) throw new Error(`The domain ${domain} is not registered.`);
  await writeField(owner, key, 'connections', serializeDoorConnections(checked.connections));
  await regenerateMap();
  return checked.connections;
}

export async function getDomainTarget(domain: string): Promise<string | undefined> {
  const key = domainKey(domain);
  const owner = await resolveOwnerForKey(key);
  if (!owner) return undefined;
  const { value } = await readFromMonad<string>(await getNetgetMonadOrigin(), ownerNamespace(owner), `domains.${escapeDomainKey(key)}.target`);
  return value;
}

export async function deleteDomain(domain: string): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  const origin = await getNetgetMonadOrigin();
  await Promise.all(
    DOMAIN_FIELDS.map((field) =>
      // value is a placeholder (see deleteIndexEntry) — never null, the
      // kernel write rejects a null/undefined body regardless of operator.
      writeToMonad(origin, ownerNamespace(owner), `domains.${escapeDomainKey(key)}.${field}`, true, '-'),
    ),
  );
  await deleteIndexEntry(key);
  await regenerateMap();
}

export async function storeConfigInDB(
  domain: string,
  subdomain?: string,
  sslMode?: string,
  sslCertificate?: string,
  sslCertificateKey?: string,
  target?: string,
  type?: string,
  projectPath?: string,
  owner?: string,
): Promise<void> {
  const key = domainKey(domain);
  const domainOwner = sanitizeOwnerLabel(owner || domain.split('.').slice(-2).join('.'));
  await writeIndexEntry(key, domainOwner);
  await writeDefinedFields(domainOwner, key, {
    subdomain, sslMode, sslCertificate, sslCertificateKey,
    target, type, projectPath, owner: domainOwner, registered: true,
  });
  await regenerateMap();
}

export async function updateDnsProvider(domain: string, dnsProvider: string): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  await writeField(owner, key, 'dnsProvider', dnsProvider);
}

export async function updateSSLCertificatePaths(
  domain: string,
  certPath: string,
  keyPath: string,
): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  await writeDefinedFields(owner, key, {
    sslMode: 'letsencrypt',
    sslCertificate: certPath,
    sslCertificateKey: keyPath,
  });
  await regenerateMap();
}

// getConfig — kept for backward compat with getConfig.ts (nginx module bridge)
async function getConfig(domain: string): Promise<DomainConfigResult | undefined> {
  const rec = await getDomainByName(domain);
  if (rec) return { domain: rec.domain, type: rec.type || '', target: rec.target || '', sslCertificate: rec.sslCertificate };
  // Try wildcard: *.parent.com
  const wildcard = '*.' + domain.split('.').slice(1).join('.');
  const wRec = await getDomainByName(wildcard);
  if (wRec) return { domain: wRec.domain, type: wRec.type || '', target: wRec.target || '', sslCertificate: wRec.sslCertificate };
  return undefined;
}

const domainStoreDefault = { getConfig };
export default domainStoreDefault;
