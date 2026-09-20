// mainServerEntry.ts -- from "the namespace says its main server is X" to "X is a door
// into the namespace".
//
// Two relations, and this file is the rule that joins them:
//
//   namespace -> netget.main.server.name -> "netget.site"     (the tree names the domain)
//   "netget.site" -> namespace -> root of the tree            (the domain enters the tree)
//
// The first is data in the tree (monad: claim/mainServer.ts). The second is not stored
// by hand anywhere: this reads the first and derives it. There is no second setting to
// keep in step -- change the path (the owner's signature does that) and the entry
// follows; remove the declaration's effect by declaring another name and the entry it
// derived for the old one is retired.
//
// What it derives, from the declaration alone:
//   - a domain record for the name (type main_server) in the gateway's kernel, which
//     is what nginx's routing table (domain-map.json) is projected from;
//   - the certificate, when one is already on disk for that name (netget does not issue
//     one here; whether it is present is reported, not required);
//   - runtime/main-server.json: the generated state nginx/OpenResty reads instead of a
//     name baked into nginx.conf.
//
// What it refuses: a name that is not a host, and a name another purpose already holds
// (a domain registered as something else is not this file's to repurpose).

import fs from 'node:fs';
import path from 'node:path';
import { normalizeMainServerName, MAIN_SERVER_NAME_PATH } from 'monad.ai';
import { getNetgetDataDir } from '../utils/netgetPaths.js';

export const MAIN_SERVER_DOMAIN_TYPE = 'main_server';
const DERIVED_OWNER = 'netget';

export type MainServerStatus = 'unset' | 'ready' | 'invalid' | 'conflict';

export interface MainServerState {
  status: MainServerStatus;
  /** What the namespace declares (normalized), or null. */
  name: string | null;
  /** The namespace whose root the name enters. */
  namespace: string;
  /** Whether a certificate for the name is on disk; null while there is no name to serve. */
  tls: 'present' | 'missing' | null;
  reason?: string;
  derivedAt: string;
}

export interface MainServerDomain {
  domain: string;
  type?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
}

export interface MainServerDeps {
  namespace: string;
  /** The declaration, as the namespace answers it. undefined = nothing declared. */
  readDeclared(): Promise<unknown>;
  listDomains(): Promise<MainServerDomain[]>;
  registerDomain(record: { domain: string; type: string; owner: string; cert?: { certificate: string; key: string } }): Promise<void>;
  attachCertificate(domain: string, cert: { certificate: string; key: string }): Promise<void>;
  deleteDomain(domain: string): Promise<void>;
  /** Certificate files already on disk for the name, if any. */
  findCertificate(domain: string): { certificate: string; key: string } | null;
  writeState(state: MainServerState): void;
}

function stateOf(deps: MainServerDeps, partial: Omit<MainServerState, 'namespace' | 'derivedAt'>): MainServerState {
  return { ...partial, namespace: deps.namespace, derivedAt: new Date().toISOString() };
}

export async function reconcileMainServer(deps: MainServerDeps): Promise<MainServerState> {
  const declared = await deps.readDeclared();

  let state: MainServerState;
  if (declared === undefined || declared === null || declared === '') {
    state = stateOf(deps, { status: 'unset', name: null, tls: null });
    deps.writeState(state);
    return state;
  }

  const name = typeof declared === 'string' ? normalizeMainServerName(declared) : null;
  if (!name) {
    state = stateOf(deps, { status: 'invalid', name: null, tls: null, reason: `${MAIN_SERVER_NAME_PATH} is not a host name` });
    deps.writeState(state);
    return state;
  }

  const domains = await deps.listDomains();
  const held = domains.find((d) => d.domain.toLowerCase() === name);
  if (held && held.type !== MAIN_SERVER_DOMAIN_TYPE) {
    state = stateOf(deps, {
      status: 'conflict', name, tls: null,
      reason: `${name} is already registered as "${held.type ?? 'unknown'}", not as the main server`,
    });
    deps.writeState(state);
    return state;
  }

  const cert = deps.findCertificate(name);
  if (!held) {
    await deps.registerDomain({ domain: name, type: MAIN_SERVER_DOMAIN_TYPE, owner: DERIVED_OWNER, ...(cert ? { cert } : {}) });
  } else if (cert && !held.sslCertificate) {
    await deps.attachCertificate(name, cert);
  }

  // A name the namespace no longer declares stops being a door: retire what this rule derived for it.
  for (const stale of domains.filter((d) => d.type === MAIN_SERVER_DOMAIN_TYPE && d.domain.toLowerCase() !== name)) {
    await deps.deleteDomain(stale.domain);
  }

  const tls = cert || held?.sslCertificate ? 'present' : 'missing';
  state = stateOf(deps, { status: 'ready', name, tls });
  deps.writeState(state);
  return state;
}

// ── the generated state OpenResty reads ────────────────────────────────────

export function getMainServerStatePath(): string {
  return path.join(getNetgetDataDir(), 'runtime', 'main-server.json');
}

/** Atomic (tmp -> rename) so a Lua worker never reads a half-written file. */
export function writeMainServerState(state: MainServerState, filePath = getMainServerStatePath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readMainServerState(filePath = getMainServerStatePath()): MainServerState | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as MainServerState;
  } catch {
    return null;
  }
}

// ── wiring to the real things ──────────────────────────────────────────────

const LETSENCRYPT_LIVE = '/etc/letsencrypt/live';

export function findLetsEncryptCertificate(domain: string, liveDir = LETSENCRYPT_LIVE): { certificate: string; key: string } | null {
  const certificate = path.join(liveDir, domain, 'fullchain.pem');
  const key = path.join(liveDir, domain, 'privkey.pem');
  return fs.existsSync(certificate) && fs.existsSync(key) ? { certificate, key } : null;
}

export async function defaultMainServerDeps(): Promise<MainServerDeps> {
  const { getNetgetMonadOrigin, getGatewayRootNamespace } = await import('../kernel/netgetMonadProcess.ts');
  const { readFromMonad } = await import('../kernel/monadHttpClient.ts');
  const store = await import('../kernel/domainStore.ts');
  const namespace = getGatewayRootNamespace();
  return {
    namespace,
    readDeclared: async () => (await readFromMonad(await getNetgetMonadOrigin(), namespace, MAIN_SERVER_NAME_PATH)).value,
    listDomains: async () => (await store.getDomains()) as MainServerDomain[],
    registerDomain: async ({ domain, type, owner, cert }) => {
      await store.registerDomain(
        domain, undefined, undefined, cert ? 'letsencrypt' : undefined, cert?.certificate, cert?.key,
        undefined, type, undefined, owner,
      );
    },
    attachCertificate: async (domain, cert) => {
      await store.updateDomain(domain, undefined, undefined, 'letsencrypt', cert.certificate, cert.key);
    },
    deleteDomain: (domain) => store.deleteDomain(domain),
    findCertificate: (domain) => findLetsEncryptCertificate(domain),
    writeState: (state) => writeMainServerState(state),
  };
}

/**
 * Keeps the entry in step with the namespace. The change usually arrives through the
 * monad's own signed endpoint, not through netget, so netget looks: once now, then on a
 * timer. Failures (the monad not listening yet) leave the last state as it was.
 */
export function startMainServerReconciler(
  options: { intervalMs?: number; deps?: () => Promise<MainServerDeps>; log?: (line: string) => void } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 5000;
  const log = options.log ?? ((line: string) => console.log(line));
  const makeDeps = options.deps ?? defaultMainServerDeps;
  let last = '';
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const state = await reconcileMainServer(await makeDeps());
      const summary = `${state.status}:${state.name ?? ''}:${state.tls ?? ''}`;
      if (summary !== last) {
        last = summary;
        log(`[netget] main server: ${state.status}${state.name ? ` ${state.name}` : ''}${state.reason ? ` (${state.reason})` : ''}${state.tls ? ` tls=${state.tls}` : ''}`);
      }
    } catch {
      // monad not up yet, or unreachable: keep the last state
    } finally {
      running = false;
    }
  };

  void tick();
  if (intervalMs <= 0) return () => { stopped = true; };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
