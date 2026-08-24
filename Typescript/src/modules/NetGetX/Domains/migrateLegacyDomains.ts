// migrateLegacyDomains.ts
//
// One-time migration: copy every row from the legacy sqlite domains table
// (the pre-.me store — see docs/DomainStoreSplitBrain.md) into the kernel-
// backed domainStore.ts. Exists because a deployment's real domain/cert
// config can be sitting entirely in the old sqlite file while the current
// code's generateDomainMap() (runtime/domainMap.ts) only ever reads the
// kernel — meaning that deployment's cert-selection domain-map silently
// contains none of its real domains until this runs once.
//
// Safe to re-run: upserts (register, falling back to update on "already
// exists") rather than assuming a clean kernel.
import { spawnSync } from 'child_process';
import chalk from 'chalk';

interface LegacyDomainRow {
  domain: string;
  subdomain?: string | null;
  email?: string | null;
  sslMode?: string | null;
  sslCertificate?: string | null;
  sslCertificateKey?: string | null;
  target?: string | null;
  type?: string | null;
  projectPath?: string | null;
  owner?: string | null;
}

// Shells out to the sqlite3 CLI (-json) rather than depending on the
// sqlite3 npm package, which requires a native build and isn't even a
// declared dependency of this package (utils_sqlite3.ts imports it anyway —
// that module has apparently never been importable outside whatever
// deployment happened to have it globally present). The CLI binary is
// already a hard requirement for anyone running the legacy store at all.
function readLegacyDomains(sqlitePath: string): LegacyDomainRow[] {
  const query =
    'SELECT domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner FROM domains;';
  const r = spawnSync('sqlite3', ['-json', sqlitePath, query], { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `sqlite3 exited with code ${r.status}`);
  const trimmed = r.stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as LegacyDomainRow[];
}

// Legacy rows sometimes store `target` as a bare port number ("8181")
// instead of "host:port" — found live on netget.site across 26 domains.
// setNginxConfigFile.ts's proxy_pass construction does `"http://" ..
// target`, so a bare port produces `http://8181` (tries to resolve a host
// literally named "8181"), a 502 for every request to that domain — cert
// and routing can both otherwise be perfectly correct and it won't matter.
// Normalized here so every future migration gets this for free, not just
// a one-off fix on this VM.
function normalizeTarget(target: string | null | undefined): string | null | undefined {
  if (target && /^\d+$/.test(target)) return `127.0.0.1:${target}`;
  return target;
}

export interface MigrationResult {
  ok: boolean;
  message: string;
  migrated: number;
  skipped: number;
  errors: Array<{ domain: string; message: string }>;
}

/**
 * Migrates every row in the legacy sqlite `domains` table into the kernel
 * store, then regenerates the domain-map once at the end. Rows with no
 * `domain` value are skipped. `sslMode`/certs/target/type are carried over
 * as-is — this migrates data, it does not validate or re-provision certs.
 */
export async function migrateLegacyDomains(sqlitePath: string): Promise<MigrationResult> {
  const { registerDomain, updateDomain, getDomainByName } = await import('../../../kernel/domainStore.ts');

  let rows: LegacyDomainRow[];
  try {
    rows = readLegacyDomains(sqlitePath);
  } catch (err: any) {
    return {
      ok: false,
      message: `Could not read legacy sqlite database at ${sqlitePath}: ${err instanceof Error ? err.message : String(err)}`,
      migrated: 0,
      skipped: 0,
      errors: [],
    };
  }

  let migrated = 0;
  let skipped = 0;
  const errors: Array<{ domain: string; message: string }> = [];

  for (const row of rows) {
    const domain = row.domain?.trim();
    if (!domain) {
      skipped++;
      continue;
    }

    const args = [
      row.subdomain ?? undefined,
      row.email ?? undefined,
      row.sslMode ?? undefined,
      row.sslCertificate ?? undefined,
      row.sslCertificateKey ?? undefined,
      normalizeTarget(row.target) ?? undefined,
      row.type ?? undefined,
      row.projectPath ?? undefined,
      row.owner ?? undefined,
    ] as const;

    try {
      const existing = await getDomainByName(domain);
      if (existing) {
        await updateDomain(domain, ...args);
      } else {
        await registerDomain(domain, ...args);
      }
      migrated++;
      console.log(chalk.green(`  ✓ ${domain}`));
    } catch (err: any) {
      errors.push({ domain, message: err instanceof Error ? err.message : String(err) });
      console.log(chalk.red(`  ✗ ${domain}: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  return {
    ok: errors.length === 0,
    message: `Migrated ${migrated} domain(s), skipped ${skipped}, ${errors.length} error(s).`,
    migrated,
    skipped,
    errors,
  };
}
