/**
 * domainStore.ts
 *
 * Domain registry backed by the .me semantic kernel.
 * Drop-in replacement for sqlite/utils_sqlite3.ts — same public API,
 * zero native dependencies.
 *
 * Storage layout in the kernel:
 *   me.domains["example.com"].target   → routing target
 *   me.domains["example.com"].type     → "proxy" | "static" | "server"
 *   me.domains["example.com"].ssl.cert → cert path
 *   me.domains["example.com"].ssl.key  → key path
 *   me.domains["example.com"].owner    → owner string
 *   me.domains["example.com"].email    → contact email
 *   me.domains["example.com"].subdomain
 *   me.domains["example.com"].projectPath
 *   me.domains["example.com"].sslMode
 *   me.domains["example.com"].nginxConfig
 *   me.domains["example.com"].rootDomain
 *
 * The kernel is persisted to ~/.get/kernel/snapshot.json via DiskStore.
 * No sqlite3, no native addons, no GLIBC constraints.
 */

import ME from 'this.me';
import path from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import { getNetgetDataDir } from '../utils/netgetPaths.js';

// ── Kernel singleton ──────────────────────────────────────────────────────────

const GATEWAY_SEED_ENV = 'NETGET_GATEWAY_SEED';
const SNAPSHOT_FILENAME = 'snapshot.json';

function getKernelStateDir(): string {
  return path.join(getNetgetDataDir(), 'kernel');
}

function resolveGatewaySeed(): string {
  const explicit = String(process.env[GATEWAY_SEED_ENV] || '').trim();
  if (explicit) return explicit;
  // Fallback: deterministic from hostname — stable across restarts,
  // but not a security secret. Gateway config is not sensitive user data.
  return `netget-gateway:${os.hostname().toLowerCase()}`;
}

let _kernel: InstanceType<typeof ME> | null = null;

function getKernel(): InstanceType<typeof ME> {
  if (_kernel) return _kernel;
  const stateDir = getKernelStateDir();
  mkdirSync(stateDir, { recursive: true });
  const seed = resolveGatewaySeed();
  _kernel = new ME(seed, {
    store: new ME.DiskStore({ baseDir: stateDir }),
  });
  const snapshotPath = path.join(stateDir, SNAPSHOT_FILENAME);
  if (existsSync(snapshotPath)) {
    try {
      _kernel.hydrate(JSON.parse(readFileSync(snapshotPath, 'utf8')));
    } catch {
      // snapshot corrupt or incompatible — start fresh
    }
  }
  return _kernel;
}

function saveKernel(): void {
  if (!_kernel) return;
  const stateDir = getKernelStateDir();
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, SNAPSHOT_FILENAME),
    JSON.stringify((_kernel as any).exportSnapshot()),
    'utf8',
  );
}

// ── Types (same as utils_sqlite3.ts) ─────────────────────────────────────────

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
}

export interface DomainConfigResult {
  domain: string;
  type: string;
  port?: number;
  sslCertificate?: string;
  target: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function domainKey(domain: string): string {
  // Dots in domain names are valid .me path separators only if we escape them.
  // We store domains as indexed entries: domains[<domain>]
  return domain.toLowerCase().trim();
}

function readDomainRecord(me: InstanceType<typeof ME>, domain: string): DomainRecord | undefined {
  const key = domainKey(domain);
  const target   = (me as any)(`domains.${key}.target`);
  const type     = (me as any)(`domains.${key}.type`);
  // If neither target nor type exists, this domain isn't registered
  if (target === undefined && type === undefined) {
    // Check if any field exists
    const owner = (me as any)(`domains.${key}.owner`);
    if (owner === undefined) return undefined;
  }
  return {
    domain: key,
    target:          (me as any)(`domains.${key}.target`),
    type:            (me as any)(`domains.${key}.type`),
    subdomain:       (me as any)(`domains.${key}.subdomain`),
    email:           (me as any)(`domains.${key}.email`),
    sslMode:         (me as any)(`domains.${key}.sslMode`),
    sslCertificate:  (me as any)(`domains.${key}.sslCertificate`),
    sslCertificateKey: (me as any)(`domains.${key}.sslCertificateKey`),
    projectPath:     (me as any)(`domains.${key}.projectPath`),
    rootDomain:      (me as any)(`domains.${key}.rootDomain`),
    owner:           (me as any)(`domains.${key}.owner`),
    nginxConfig:     (me as any)(`domains.${key}.nginxConfig`),
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

// ── Public API (mirrors utils_sqlite3.ts) ─────────────────────────────────────

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
  const me = getKernel();
  const key = domainKey(domain);
  const existing = readDomainRecord(me, key);
  if (existing) throw new Error(`The domain ${domain} already exists.`);

  const d = (me as any).domains[key];
  if (subdomain)       d.subdomain(subdomain);
  if (email)           d.email(email);
  if (sslMode)         d.sslMode(sslMode);
  if (sslCertificate)  d.sslCertificate(sslCertificate);
  if (sslCertificateKey) d.sslCertificateKey(sslCertificateKey);
  if (target)          d.target(target);
  if (type)            d.type(type);
  if (projectPath)     d.projectPath(projectPath);
  if (owner)           d.owner(owner);
  // Write a sentinel so the domain is "registered" even with minimal fields
  d.registered(true);

  saveKernel();
  await regenerateMap();
}

/**
 * Collect candidate domain keys ("domains.<name>") from every source that
 * might know about them: the live in-memory index (populated by writes made
 * in this process) AND the on-disk snapshot's raw memory log (covers domains
 * registered in a previous process — hydrate() should rebuild `.index` from
 * this too, but we scan it directly as a robust fallback in case it doesn't).
 */
function collectDomainKeys(me: InstanceType<typeof ME>): Set<string> {
  const domainPartFromPath = (p: string): string | undefined => {
    if (!p.startsWith('domains.')) return undefined;
    const rest = p.slice('domains.'.length);
    const domainPart = rest.split('.')[0];
    return domainPart || undefined;
  };

  const seen = new Set<string>();

  const index: Record<string, unknown> = (me as any).index || {};
  for (const k of Object.keys(index)) {
    const d = domainPartFromPath(k);
    if (d) seen.add(d);
  }

  try {
    const snapshotPath = path.join(getKernelStateDir(), SNAPSHOT_FILENAME);
    if (existsSync(snapshotPath)) {
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      const memories: Array<{ path?: string }> = snapshot?.memories || [];
      for (const m of memories) {
        const d = m?.path ? domainPartFromPath(m.path) : undefined;
        if (d) seen.add(d);
      }
    }
  } catch {
    // best-effort fallback only
  }

  return seen;
}

export async function getDomains(): Promise<DomainRecord[]> {
  const me = getKernel();
  const results: DomainRecord[] = [];

  for (const domainPart of collectDomainKeys(me)) {
    const rec = readDomainRecord(me, domainPart);
    if (rec) results.push(rec);
  }
  return results;
}

export async function getDomainByName(domain: string): Promise<DomainRecord | undefined> {
  return readDomainRecord(getKernel(), domain);
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
  const me = getKernel();
  const key = domainKey(domain);
  const d = (me as any).domains[key];
  if (subdomain !== undefined)       d.subdomain(subdomain);
  if (email !== undefined)           d.email(email);
  if (sslMode !== undefined)         d.sslMode(sslMode);
  if (sslCertificate !== undefined)  d.sslCertificate(sslCertificate);
  if (sslCertificateKey !== undefined) d.sslCertificateKey(sslCertificateKey);
  if (target !== undefined)          d.target(target);
  if (type !== undefined)            d.type(type);
  if (projectPath !== undefined)     d.projectPath(projectPath);
  if (owner !== undefined)           d.owner(owner);
  saveKernel();
  await regenerateMap();
}

export async function updateDomainTarget(domain: string, target: string): Promise<void> {
  const me = getKernel();
  (me as any).domains[domainKey(domain)].target(target);
  saveKernel();
  await regenerateMap();
}

export async function updateDomainType(domain: string, type: string): Promise<void> {
  const me = getKernel();
  (me as any).domains[domainKey(domain)].type(type);
  saveKernel();
  await regenerateMap();
}

export async function updateDomainRoute(
  domain: string,
  type: string | null,
  target: string | null,
): Promise<void> {
  const me = getKernel();
  const d = (me as any).domains[domainKey(domain)];
  if (type !== null)   d.type(type);
  if (target !== null) d.target(target);
  saveKernel();
  await regenerateMap();
}

export async function getDomainTarget(domain: string): Promise<string | undefined> {
  return (getKernel() as any)(`domains.${domainKey(domain)}.target`);
}

export async function deleteDomain(domain: string): Promise<void> {
  const me = getKernel();
  const key = domainKey(domain);
  // Tombstone all known fields under this domain
  const fields = ['target','type','subdomain','email','sslMode','sslCertificate',
                  'sslCertificateKey','projectPath','rootDomain','owner','nginxConfig','registered'];
  for (const f of fields) {
    try { (me as any).domains[key]['-'](f); } catch { /* field may not exist */ }
  }
  saveKernel();
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
  const me = getKernel();
  const key = domainKey(domain);
  const d = (me as any).domains[key];
  const domainOwner = owner || domain.split('.').slice(-2).join('.');
  if (subdomain !== undefined)       d.subdomain(subdomain);
  if (sslMode !== undefined)         d.sslMode(sslMode);
  if (sslCertificate !== undefined)  d.sslCertificate(sslCertificate);
  if (sslCertificateKey !== undefined) d.sslCertificateKey(sslCertificateKey);
  if (target !== undefined)          d.target(target);
  if (type !== undefined)            d.type(type);
  if (projectPath !== undefined)     d.projectPath(projectPath);
  d.owner(domainOwner);
  d.registered(true);
  saveKernel();
  await regenerateMap();
}

export async function updateSSLCertificatePaths(
  domain: string,
  certPath: string,
  keyPath: string,
): Promise<void> {
  const me = getKernel();
  const d = (me as any).domains[domainKey(domain)];
  d.sslCertificate(certPath);
  d.sslCertificateKey(keyPath);
  saveKernel();
  await regenerateMap();
}

// getConfig — kept for backward compat with getConfig.ts (nginx module bridge)
function getConfig(domain: string): Promise<DomainConfigResult | undefined> {
  return Promise.resolve().then(() => {
    const me = getKernel();
    const key = domainKey(domain);
    const rec = readDomainRecord(me, key);
    if (rec) return { domain: rec.domain, type: rec.type || '', target: rec.target || '', sslCertificate: rec.sslCertificate };
    // Try wildcard: *.parent.com
    const wildcard = '*.' + domain.split('.').slice(1).join('.');
    const wRec = readDomainRecord(me, wildcard);
    if (wRec) return { domain: wRec.domain, type: wRec.type || '', target: wRec.target || '', sslCertificate: wRec.sslCertificate };
    return undefined;
  });
}

const domainStoreDefault = { getConfig };
export default domainStoreDefault;
