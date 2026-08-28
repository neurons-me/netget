/**
 * migrateDomainsToMonad.ts
 *
 * One-time migration: existing domain records live at kernel-root
 * `domains.<key>.<field>` (written by the old embedded-kernel version of
 * domainStore.ts, before netget ran its own monad process). This script
 * reads them straight out of the legacy snapshot.json and re-writes each
 * one through the new monad's HTTP write path, landing at
 * `users.<owner-or-netget>.domains.<key>.<field>` — see domainStore.ts's
 * header comment for why that's the new location.
 *
 * NOT run automatically. Run by hand, once:
 *
 *   npx tsx src/kernel/migrateDomainsToMonad.ts
 *
 * Per the plan's verification step, run this FIRST against a *copy* of the
 * real state dir (set NETGET_DATA_DIR to point at the copy) and diff
 * getDomains() before/after for exact parity, before ever running it
 * against the real ~/.get.
 *
 * Old root-level entries are left in place afterward (not deleted) — a
 * hard delete of the legacy data is a separate, explicit decision.
 */

import ME from 'this.me';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { getNetgetDataDir } from '../utils/netgetPaths.js';
import { startNetgetMonad, getGatewayRootNamespace, resolveGatewaySeed } from './netgetMonadProcess.js';
import { writeToMonad } from './monadHttpClient.js';

const SNAPSHOT_FILENAME = 'snapshot.json';

const LEGACY_DOMAIN_FIELDS = [
  'target', 'type', 'subdomain', 'email', 'sslMode', 'sslCertificate',
  'sslCertificateKey', 'projectPath', 'rootDomain', 'owner', 'nginxConfig',
  'dnsProvider', 'registered',
] as const;

function getLegacyKernelStateDir(): string {
  return path.join(getNetgetDataDir(), 'kernel');
}

/** Same workaround domainStore.ts used to use before this migration — kept
 * here, isolated, purely to read the OLD data one last time. */
function collectLegacyDomainKeys(index: Record<string, unknown>, snapshotMemories: Array<{ path?: string }>): Set<string> {
  const domainPartFromPath = (p: string): string | undefined => {
    if (!p.startsWith('domains.')) return undefined;
    const rest = p.slice('domains.'.length);
    for (const field of LEGACY_DOMAIN_FIELDS) {
      const suffix = `.${field}`;
      if (rest.endsWith(suffix)) return rest.slice(0, -suffix.length) || undefined;
    }
    return undefined;
  };

  const seen = new Set<string>();
  for (const k of Object.keys(index)) {
    const d = domainPartFromPath(k);
    if (d) seen.add(d);
  }
  for (const m of snapshotMemories) {
    const d = m?.path ? domainPartFromPath(m.path) : undefined;
    if (d) seen.add(d);
  }
  return seen;
}

async function migrate(): Promise<void> {
  const stateDir = getLegacyKernelStateDir();
  const snapshotPath = path.join(stateDir, SNAPSHOT_FILENAME);
  if (!existsSync(snapshotPath)) {
    console.log(`No legacy snapshot at ${snapshotPath} — nothing to migrate.`);
    return;
  }

  const seed = resolveGatewaySeed();
  const legacyKernel = new ME(seed, { store: new ME.DiskStore({ baseDir: stateDir }) }) as any;
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  legacyKernel.hydrate(snapshot);

  const keys = collectLegacyDomainKeys(legacyKernel.index || {}, snapshot?.memories || []);
  console.log(`Found ${keys.size} legacy domain key(s) to migrate.`);

  console.log('Ensuring netget\'s own monad is running...');
  // startMonadProcess() (via startNetgetMonad()) already waits for the
  // health check internally — no separate polling loop needed here.
  const status = await startNetgetMonad();
  if (!status.ok || !status.origin) {
    throw new Error(`Could not start netget's own monad: ${status.message}`);
  }
  const origin = status.origin;

  const rootNamespace = getGatewayRootNamespace();

  function ownerNamespace(owner: string): string {
    const safe = String(owner || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'netget';
    return `${safe}.${rootNamespace}`;
  }

  // See domainStore.ts's escapeDomainKey comment — a real domain name
  // contains dots, which the monad's write path would otherwise split into
  // nested tree levels instead of treating as one atomic key.
  function escapeDomainKey(key: string): string {
    return key.replace(/\./g, '__DOT__');
  }

  let migrated = 0;
  let skippedDeleted = 0;
  for (const key of keys) {
    const fields: Record<string, unknown> = {};
    for (const field of LEGACY_DOMAIN_FIELDS) {
      const value = legacyKernel(`domains.${key}.${field}`);
      if (value !== undefined) fields[field] = value;
    }
    // collectLegacyDomainKeys() finds every path that was EVER written for a
    // key, including domains that were later fully deleted — a live read
    // correctly returns undefined for every field of a deleted domain. Skip
    // those rather than creating a phantom index entry with no real data.
    if (Object.keys(fields).length === 0) {
      skippedDeleted += 1;
      console.log(`  skipping ${key} — no live fields (already deleted)`);
      continue;
    }

    const owner = String(fields.owner || 'netget').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'netget';
    const escapedKey = escapeDomainKey(key);

    await writeToMonad(origin, ownerNamespace('netget'), `domainIndex.${escapedKey}`, { owner });
    for (const [field, value] of Object.entries(fields)) {
      await writeToMonad(origin, ownerNamespace(owner), `domains.${escapedKey}.${field}`, value);
    }
    migrated += 1;
    console.log(`  migrated ${key} → users.${owner}.${rootNamespace}.domains.${key} (${Object.keys(fields).length} fields)`);
  }

  console.log(`Done. Migrated ${migrated}/${keys.size} domain(s), skipped ${skippedDeleted} already-deleted.`);
  console.log('Old root-level entries were left in place, not deleted.');
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
