/**
 * netgetMonadProcess.ts
 *
 * netget runs its own instance of the generic `modules/monad/Typescript`
 * daemon instead of embedding a private `.me` kernel (see domainStore.ts,
 * which now talks to this process over HTTP via monadHttpClient.ts).
 *
 * Process management is delegated entirely to `monad.ai`'s own runtime API
 * (`startMonadProcess`/`stopMonadProcess`/`getMonadStatus`/`readMonadRecord`,
 * now exported from the package root — see modules/monad/Typescript's
 * src/index.ts) — the same functions its own `monads` CLI is built on. This
 * used to hand-roll a PID file, port constant, and spawn/health-check logic
 * here; that duplicated a more complete, already-tested implementation
 * (dev-mode tsx-watch child handling, port collision avoidance, per-instance
 * log files under ~/.monad/monads/netget/) for no reason. netget's own
 * monad's runtime state (pid, port, status, logs) now lives at
 * ~/.monad/monads/netget/monad.json — monad.ai's own convention, not a
 * netget-specific one.
 *
 * Registration with netget's own gateway is automatic and requires zero
 * code here: the spawned monad's own `netgetRegistration.ts` POSTs to
 * `NETGET_LOCAL` (default http://127.0.0.1) the same way any other monad
 * does — netget's own `/apps/report` Lua handler is already fully generic.
 */

import { startMonadProcess, stopMonadProcess, getMonadStatus, readMonadRecord } from 'monad.ai';
import { loadOrCreateXConfig } from '../modules/NetGetX/config/xConfig.ts';
import { resolveLedgerIdentity } from './ledgerIdentity.ts';

const GATEWAY_SEED_ENV = 'NETGET_GATEWAY_SEED';
// Override-only escape hatch for test isolation — a test that needs a
// real, running monad (e.g. exercising gatewaySetupSession.ts's actual
// commit path) must NEVER touch the real 'netget'-named monad process on
// whatever machine happens to be running the test; that process, if one
// exists, is a real gateway with a real ledger (confirmed the hard way —
// see the 2026-09 incident this env var exists to prevent recurring:
// an earlier test's success-path assertion wrote a throwaway identity
// into the real ambient monad's real ledger, because nothing scoped
// which monad process "netget" resolved to). Production code paths never
// set this; it exists purely so a test can point every function in this
// file at an isolated, disposable monad instance instead. Read fresh on
// every call, not frozen at import time, matching getNetgetDataDir()'s
// own pattern for the same reason.
export function getMonadName(): string {
  return String(process.env.NETGET_MONAD_NAME || '').trim() || 'netget';
}

export interface NetgetMonadStatus {
  ok: boolean;
  running: boolean;
  pid?: number;
  port?: number;
  origin: string;
  message: string;
}

/** netget's own kernel identity seed — independent of the machine's
 * hostname, whatever public domain an operator later chooses, and whoever
 * currently administers the gateway (see GatewayClaimsManager.ts's
 * `owner` — a deliberately separate concept: the owner administers this
 * ledger, the owner is not this ledger). "Not sensitive" in the sense
 * that it's gateway config, not a human user's own `.me` secret — but it
 * IS this service's actual private identity now (see ledgerIdentity.ts),
 * not the old hostname-derivable placeholder this comment used to
 * describe.
 *
 * Priority: an explicit NETGET_GATEWAY_SEED env override (unchanged —
 * still wins over everything), then the persisted ledger identity
 * (generated once on a fresh install, reused forever after, or the old
 * hostname-derived value unchanged if this installation already has
 * state and hasn't been migrated to a persisted identity yet — see
 * ledgerIdentity.ts's resolveLedgerIdentity() for exactly how that's
 * decided). */
export function resolveGatewaySeed(): string {
  const explicit = String(process.env[GATEWAY_SEED_ENV] || '').trim();
  if (explicit) return explicit;
  return resolveLedgerIdentity().seedHex;
}

// Cached synchronously so getGatewayRootNamespace() itself can stay a plain
// sync function — domainStore.ts calls it from many places, and making it
// async would ripple an `await` through all of them for a value that only
// ever changes when an operator explicitly reconfigures mainServerName, not
// per-request. Same "memoize a promise, read the resolved value after"
// shape as _originPromise/getNetgetMonadOrigin() below. Populated once at
// boot (proxy.js) — before that resolves, callers just see the hostname
// fallback, same as before this existed.
let _mainServerNameCache: string | null = null;

/** Loads xConfig's operator-set mainServerName (the same "choose your own
 * domain" field netget's own dashboard already uses — mainServer.cli.ts)
 * into the sync cache getGatewayRootNamespace() reads. Call once at process
 * boot; safe to call again later if an operator changes mainServerName
 * (e.g. after running the mainServer CLI) to pick up the new value without
 * a restart. */
export async function loadGatewayRootNamespaceCache(): Promise<void> {
  try {
    const xConfig = await loadOrCreateXConfig();
    _mainServerNameCache = String(xConfig.mainServerName || '').trim().toLowerCase() || null;
  } catch {
    _mainServerNameCache = null;
  }
}

/** netget's own monad root namespace. Three sources, in priority order:
 * an explicit NETGET_MONAD_NAMESPACE env override, the operator's
 * configured mainServerName (xConfig — the same "choose your own domain"
 * field netget's own dashboard already exposes, e.g. "local.cleaker" or a
 * public "cleaker.me"), or the literal string "local.cleaker" as the
 * default — NOT the machine hostname. A bare `os.hostname()` fallback was
 * the same host/namespace category error this stack spent real effort
 * naming and ruling out elsewhere (see cleaker/typedocs/
 * Namespace-Is-Context.md): a namespace must be a *designated* context,
 * never silently derived from whatever physical host happens to answer.
 * "local.cleaker" is the correct unconfigured default specifically because
 * it already IS a designated local namespace in this system's own model —
 * not a stand-in for one — and once an operator runs mainServer.cli.ts to
 * pick "cleaker.me" or another public domain, that choice always wins over
 * this default. Hostname-shaped strings/mainServerName both need the same
 * 2-label shape every monad on this host uses for ME_NAMESPACE (confirmed
 * by testing: cleaker's parseNamespaceExpression only cleanly parses
 * "<prefix>.<constant>" where constant is a normal hostname-shaped root —
 * an invented 3-label root like "netget-gateway.<hostname>" plus a
 * "<owner>." prefix on top of it silently failed to round-trip:
 * namespaceToKernelPrefix() returned no prefix at all, and writes landed
 * unprefixed at kernel root instead of users.<owner>.*) — "local.cleaker"
 * satisfies that shape too. This monad is a separate process/port/kernel
 * from any other monad on the machine, so reusing the same namespace
 * *string* isn't
 * a collision — nothing else routes traffic to it by that name. */
const UNCONFIGURED_DEFAULT_NAMESPACE = 'local.cleaker';

export function getGatewayRootNamespace(): string {
  const explicit = String(process.env.NETGET_MONAD_NAMESPACE || '').trim();
  if (explicit) return explicit;
  if (_mainServerNameCache) return _mainServerNameCache;
  return UNCONFIGURED_DEFAULT_NAMESPACE;
}

function toNetgetStatus(status: Awaited<ReturnType<typeof getMonadStatus>>): NetgetMonadStatus {
  return {
    ok: true,
    running: status.healthy && status.status === 'running',
    pid: status.record.pid,
    port: status.record.port,
    origin: status.record.endpoint,
    message: status.healthy
      ? `netget's own monad responding at ${status.record.endpoint}.`
      : (status.error || `netget's own monad status: ${status.status}.`),
  };
}

export async function getNetgetMonadStatus(): Promise<NetgetMonadStatus> {
  const record = await readMonadRecord(getMonadName());
  if (!record) {
    return { ok: true, running: false, origin: '', message: "netget's own monad is not running." };
  }
  return toNetgetStatus(await getMonadStatus(record));
}

export async function startNetgetMonad(options: { port?: number } = {}): Promise<NetgetMonadStatus> {
  try {
    return toNetgetStatus(await startMonadProcess({
      name: getMonadName(),
      namespace: getGatewayRootNamespace(),
      seed: resolveGatewaySeed(),
      // Optional: lets a caller that already reserved a specific port (e.g.
      // a disposable-monad test arming a request guard for that EXACT
      // origin before this call, closing the window a guard armed only
      // after the fact would leave open during monad.ai's own startup
      // health probe) hand it straight to startMonadProcess()'s own
      // findFreePort(options.port ?? existing?.port), instead of letting
      // it pick an origin the caller can't know in advance. Omitted, this
      // is unchanged from before — production callers (proxy.js, the CLI)
      // never pass it.
      ...(options.port ? { port: options.port } : {}),
    }));
  } catch (error) {
    // startMonadProcess throws if a record already shows it running — treat
    // that as success rather than an error, same as the old idempotent
    // startNetgetMonad() contract callers (proxy.js) already expect.
    if (error instanceof Error && error.message.includes('already running')) {
      return getNetgetMonadStatus();
    }
    return { ok: false, running: false, origin: '', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopNetgetMonad(): Promise<{ ok: boolean; message: string }> {
  try {
    const status = await stopMonadProcess(getMonadName());
    return { ok: true, message: `netget's own monad (pid ${status.record.pid}) stopped.` };
  } catch (error) {
    return { ok: true, message: error instanceof Error ? error.message : "netget's own monad is not running." };
  }
}

// Memoized origin lookup for domainStore.ts's frequent per-field calls —
// proxy.js already calls startNetgetMonad() once at boot; this just needs
// to know where that already-running instance ended up (port is
// dynamically allocated by monad.ai's own findFreePort()), not re-trigger
// a start on every domain read/write.
let _originPromise: Promise<string> | null = null;

export function getNetgetMonadOrigin(): Promise<string> {
  if (!_originPromise) {
    _originPromise = startNetgetMonad().then((status) => {
      if (!status.ok || !status.origin) {
        _originPromise = null; // allow a retry on the next call
        throw new Error(status.message || "Could not determine netget's own monad origin.");
      }
      return status.origin;
    });
  }
  return _originPromise;
}
