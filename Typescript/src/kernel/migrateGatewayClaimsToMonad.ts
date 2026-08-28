import { pathToFileURL } from 'node:url';
import {
  GatewayClaimsManager,
  gatewayClaimsSnapshotToLedgerEntries,
  getGatewayClaimsPath,
  type GatewayClaimsManagerOptions,
  type GatewayClaimsSnapshot,
} from '../modules/NetGetX/Auth/GatewayClaimsManager.js';

export interface GatewayClaimsMigrationResult {
  ok: boolean;
  claimsPath: string;
  owner: string | null;
  entries: number;
  message: string;
}

export async function migrateGatewayClaimsToMonad(
  options: GatewayClaimsManagerOptions & {
    gatewayId?: string;
    snapshot?: GatewayClaimsSnapshot | null;
  } = {},
): Promise<GatewayClaimsMigrationResult> {
  const mgr = new GatewayClaimsManager(options.gatewayId, options);
  const snapshot = options.snapshot ?? mgr.read();
  const claimsPath = getGatewayClaimsPath();

  if (!snapshot?.owner) {
    return {
      ok: true,
      claimsPath,
      owner: null,
      entries: 0,
      message: 'No gateway owner found; nothing to migrate.',
    };
  }

  const entries = gatewayClaimsSnapshotToLedgerEntries(snapshot, null);
  await mgr.writeLedger(snapshot, null);
  const materialized = await mgr.materializeFromLedger(snapshot);

  return {
    ok: true,
    claimsPath,
    owner: materialized.owner,
    entries: entries.length,
    message: `Migrated gateway claims to the netget monad ledger and refreshed ${claimsPath}.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateGatewayClaimsToMonad()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
      process.exit(1);
    });
}
