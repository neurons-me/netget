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
  'dnsProvider', 'registered',
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
  const key = domainKey(domain);
  const existingOwner = await resolveOwnerForKey(key);
  if (existingOwner) throw new Error(`The domain ${domain} already exists.`);

  const resolvedOwner = sanitizeOwnerLabel(owner);
  await writeIndexEntry(key, resolvedOwner);
  await writeDefinedFields(resolvedOwner, key, {
    subdomain, email, sslMode, sslCertificate, sslCertificateKey,
    target, type, projectPath, owner: resolvedOwner, registered: true,
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
    target, type, projectPath, owner: owner !== undefined ? targetOwner : undefined,
  });
  await regenerateMap();
}

export async function updateDomainTarget(domain: string, target: string): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  await writeField(owner, key, 'target', target);
  await regenerateMap();
}

export async function updateDomainType(domain: string, type: string): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  await writeField(owner, key, 'type', type);
  await regenerateMap();
}

export async function updateDomainRoute(
  domain: string,
  type: string | null,
  target: string | null,
): Promise<void> {
  const key = domainKey(domain);
  const owner = (await resolveOwnerForKey(key)) || NETGET_OWNER_FALLBACK;
  if (type !== null) await writeField(owner, key, 'type', type);
  if (target !== null) await writeField(owner, key, 'target', target);
  await regenerateMap();
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
