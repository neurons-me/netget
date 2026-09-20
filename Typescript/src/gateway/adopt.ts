import { readMonadEnv, readMonadRecord, writeMonadEnv } from 'monad.ai';
import { saveXConfig } from '../modules/NetGetX/config/xConfig.ts';
import { resolveGatewaySeed } from '../kernel/netgetMonadProcess.ts';
import { resolveLedgerIdentity } from '../kernel/ledgerIdentity.ts';

/**
 * Makes an existing monad THE gateway's monad: the one that also serves the
 * gateway's API (src/gateway/monadModule.mjs), so netget runs as that monad and
 * nothing else -- no standalone backend on :3000, no second monad of its own.
 *
 * It only records what the monad should start with and where nginx should send
 * the gateway's API. It does not restart the monad and does not touch nginx;
 * those are separate, explicit steps.
 *
 * The seed is left alone unless asked: a monad's seed is its namespace's
 * authority, and changing it changes who that monad is.
 */
export const GATEWAY_MODULE = 'netget/gateway';

export interface AdoptOptions {
  monad: string;
  /** A built front end for the monad to serve (its index.html and /assets). */
  frontendDir?: string;
  /** Start the monad with netget's own persisted ledger identity as its seed. */
  useGatewaySeed?: boolean;
}

export interface AdoptResult {
  monad: string;
  namespace: string;
  endpoint: string;
  /** Names of the variables now stored for the monad (values are never returned). */
  stored: string[];
  seedChanged: boolean;
  gatewayUpstream: string;
}

export function mergeModules(existing: string | undefined, add: string): string {
  const list = String(existing ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!list.includes(add)) list.push(add);
  return list.join(',');
}

export async function adoptMonadAsGateway(options: AdoptOptions): Promise<AdoptResult> {
  const record = await readMonadRecord(options.monad);
  if (!record) throw new Error(`No monad named "${options.monad}". Create it first: monads start ${options.monad} --namespace <namespace>`);

  const stored = readMonadEnv(record.name);
  const patch: Record<string, string | null> = {
    MONAD_MODULES: mergeModules(stored.MONAD_MODULES, GATEWAY_MODULE),
    NETGET_MONAD_NAME: record.name,
    NETGET_MONAD_NAMESPACE: record.namespace,
  };
  if (options.frontendDir) patch.MONAD_FRONTEND_DIR = options.frontendDir;
  if (options.useGatewaySeed) {
    // An installation with state but no ledger-identity.json is still on the
    // seed derived from its hostname: public, so not one to hand a monad.
    if (!process.env.NETGET_GATEWAY_SEED && resolveLedgerIdentity().requiresMigration) {
      throw new Error(
        "This installation has no persisted ledger identity (ledger-identity.json), so netget's seed would be the "
        + 'legacy one derived from the hostname, which is public. Give the monad its own random seed instead: '
        + `openssl rand -hex 32 | monads env ${record.name} --seed-from-stdin`,
      );
    }
    patch.SEED = resolveGatewaySeed();
  }

  const after = writeMonadEnv(record.name, patch);
  await saveXConfig({ gatewayUpstream: record.endpoint });

  return {
    monad: record.name,
    namespace: record.namespace,
    endpoint: record.endpoint,
    stored: Object.keys(after).sort(),
    seedChanged: Boolean(options.useGatewaySeed),
    gatewayUpstream: record.endpoint,
  };
}
