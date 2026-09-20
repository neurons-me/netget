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
//     name baked into nginx.conf: what is declared, the doors that exist, which one is
//     active, and for each whether it is reachable from the outside.
//
// What it refuses: a name that is not a host, and a name another purpose already holds
// (a domain registered as something else is not this file's to repurpose). What it never
// does: leave the gateway without a working main server -- see reconcileMainServer.

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { normalizeMainServerName, MAIN_SERVER_NAME_PATH } from 'monad.ai';
import { getNetgetDataDir } from '../utils/netgetPaths.js';

export const MAIN_SERVER_DOMAIN_TYPE = 'main_server';
const DERIVED_OWNER = 'netget';
const RECHECK_OK_MS = 5 * 60_000;
const RETRY_FAILING_MS = 30_000;

// Three different facts, kept apart -- a valid name proves none of the next two:
//   declared    what the namespace says (a name, valid or not)
//   configured  a door for it exists in the gateway (kernel record, routing table)
//   reachable   the name, from the outside, reaches THIS namespace (DNS, TLS and routing)
export type DeclaredStatus = 'unset' | 'valid' | 'invalid' | 'conflict';
export type Reachability = 'ok' | 'failing' | 'unchecked';

export interface MainServerDoor {
  name: string;
  /** Whether a certificate for the name is on disk. */
  tls: 'present' | 'missing';
  reachable: Reachability;
  reason?: string;
  checkedAt?: string;
}

export interface MainServerState {
  /** The namespace whose root every door enters. */
  namespace: string;
  declared: { name: string | null; status: DeclaredStatus; reason?: string };
  /** The doors that exist now: the active one and, while the name is changing, the one being replaced. */
  doors: MainServerDoor[];
  /** The door the rest of the gateway treats as the main server: the last one that was valid. */
  active: string | null;
  derivedAt: string;
}

export interface MainServerDomain {
  domain: string;
  type?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
}

export interface ProbeResult { reachable: 'ok' | 'failing'; reason?: string }

export interface MainServerDeps {
  namespace: string;
  /** The declaration, as the namespace answers it. undefined = nothing declared. Throws when it cannot be read. */
  readDeclared(): Promise<unknown>;
  listDomains(): Promise<MainServerDomain[]>;
  registerDomain(record: { domain: string; type: string; owner: string; cert?: { certificate: string; key: string } }): Promise<void>;
  attachCertificate(domain: string, cert: { certificate: string; key: string }): Promise<void>;
  deleteDomain(domain: string): Promise<void>;
  /** Certificate files already on disk for the name, if any. */
  findCertificate(domain: string): { certificate: string; key: string } | null;
  /** Does the name, from the outside, reach this namespace? */
  probe(domain: string): Promise<ProbeResult>;
  readState(): MainServerState | null;
  writeState(state: MainServerState): void;
  now(): number;
}

function withoutStamps(state: MainServerState | null): string {
  if (!state) return '';
  return JSON.stringify({ ...state, derivedAt: undefined });
}

/**
 * Brings the gateway's doors in step with what the namespace declares -- without ever
 * leaving the gateway without a working main server:
 *   - an unreadable declaration (this throws) leaves the last state untouched;
 *   - an empty, invalid or contested declaration is recorded as such and changes nothing else;
 *   - a new valid name gets its door first; it becomes the active one once it is reachable
 *     (or when there was no active door), and only then is the previous door retired.
 */
export async function reconcileMainServer(deps: MainServerDeps): Promise<MainServerState> {
  const declared = await deps.readDeclared();
  const previous = deps.readState();
  const commit = (state: MainServerState) => {
    if (withoutStamps(state) !== withoutStamps(previous)) deps.writeState(state);
    return state;
  };
  const base = { namespace: deps.namespace, derivedAt: new Date(deps.now()).toISOString() };
  const keep = (decl: MainServerState['declared']): MainServerState => commit({
    ...base, declared: decl, doors: previous?.doors ?? [], active: previous?.active ?? null,
  });

  if (declared === undefined || declared === null || declared === '') {
    return keep({ name: null, status: 'unset' });
  }
  const name = typeof declared === 'string' ? normalizeMainServerName(declared) : null;
  if (!name) {
    return keep({ name: null, status: 'invalid', reason: `${MAIN_SERVER_NAME_PATH} is not a host name` });
  }

  const domains = await deps.listDomains();
  const held = domains.find((d) => d.domain.toLowerCase() === name);
  if (held && held.type !== MAIN_SERVER_DOMAIN_TYPE) {
    return keep({
      name, status: 'conflict',
      reason: `${name} is already registered as "${held.type ?? 'unknown'}", not as the main server`,
    });
  }

  // configured: the door exists (registered first, with the certificate when one is on disk)
  const cert = deps.findCertificate(name);
  if (!held) {
    await deps.registerDomain({ domain: name, type: MAIN_SERVER_DOMAIN_TYPE, owner: DERIVED_OWNER, ...(cert ? { cert } : {}) });
  } else if (cert && !held.sslCertificate) {
    await deps.attachCertificate(name, cert);
  }
  const tlsOf = (domain: string, record?: MainServerDomain): 'present' | 'missing' =>
    deps.findCertificate(domain) || record?.sslCertificate ? 'present' : 'missing';

  // reachable: asked of the outside, not assumed; re-asked when stale or failing
  const now = deps.now();
  const known = previous?.doors.find((d) => d.name === name);
  const fresh = known?.checkedAt !== undefined && now - Date.parse(known.checkedAt) < (known.reachable === 'ok' ? RECHECK_OK_MS : RETRY_FAILING_MS);
  let door: MainServerDoor;
  if (known && fresh && known.reachable !== 'unchecked') {
    door = { ...known, tls: tlsOf(name, held) };
  } else {
    const probed = await deps.probe(name);
    door = { name, tls: tlsOf(name, held), reachable: probed.reachable, ...(probed.reason ? { reason: probed.reason } : {}), checkedAt: new Date(now).toISOString() };
  }

  const others = domains.filter((d) => d.type === MAIN_SERVER_DOMAIN_TYPE && d.domain.toLowerCase() !== name);
  const previousActive = previous?.active && (previous.active === name || others.some((d) => d.domain.toLowerCase() === previous.active))
    ? previous.active : null;
  const active = !previousActive || previousActive === name || door.reachable === 'ok' ? name : previousActive;

  // The previous door is retired only once the new one is the active one -- i.e. answers.
  let doors: MainServerDoor[];
  if (active === name) {
    for (const stale of others) await deps.deleteDomain(stale.domain);
    doors = [door];
  } else {
    const keptOld = previous?.doors.find((d) => d.name === active) ?? { name: active, tls: tlsOf(active), reachable: 'unchecked' as Reachability };
    doors = [keptOld, door];
  }

  return commit({
    ...base, declared: { name, status: 'valid', ...(door.reachable === 'failing' && active !== name ? { reason: `${name} does not answer yet; ${active} stays the main server` } : {}) },
    doors, active,
  });
}


// ── is the name reachable from the outside? ────────────────────────────────

/**
 * Asks the name itself, over HTTPS as any visitor would, for the declaration it must be
 * serving: GET https://<name>/netget.main.server.name must answer with <name>. That one
 * request proves DNS points somewhere that answers, TLS is valid for that name, and the
 * request lands on this namespace's tree -- three things a valid name proves none of.
 * `connectHost`/`port`/`ca` exist so a test can point it at a disposable server.
 */
export function probeMainServer(
  name: string,
  options: { port?: number; connectHost?: string; ca?: string | Buffer; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const failing = (reason: string) => resolve({ reachable: 'failing', reason });
    const req = https.request({
      host: options.connectHost ?? name,
      servername: name,
      port: options.port ?? 443,
      path: `/${MAIN_SERVER_NAME_PATH}`,
      method: 'GET',
      headers: { host: name, accept: 'application/json' },
      timeout: options.timeoutMs ?? 5000,
      ...(options.ca ? { ca: options.ca } : {}),
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 65536) body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return failing(`http: answered ${res.statusCode}`);
        try {
          const value = JSON.parse(body)?.target?.value;
          if (value === name) return resolve({ reachable: 'ok' });
          return failing(`routing: it answers, but not with this namespace's declaration (got ${JSON.stringify(value)})`);
        } catch {
          return failing('routing: it answers, but not with this namespace (not the tree)');
        }
      });
    });
    req.on('timeout', () => { req.destroy(); failing('timeout: no answer'); });
    req.on('error', (error: NodeJS.ErrnoException) => {
      const code = String(error.code || '');
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return failing(`dns: ${name} does not resolve`);
      if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return failing(`network: ${code}`);
      if (/CERT|TLS|SSL|ALTNAME|SELF_SIGNED|EXPIRED|UNABLE_TO_VERIFY/i.test(code) || /certificate|tls|ssl/i.test(error.message)) {
        return failing(`tls: ${error.message}`);
      }
      return failing(`${code || 'error'}: ${error.message}`);
    });
    req.end();
  });
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
    probe: (domain) => probeMainServer(domain),
    readState: () => readMainServerState(),
    writeState: (state) => writeMainServerState(state),
    now: () => Date.now(),
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
      const active = state.doors.find((d) => d.name === state.active);
      const summary = JSON.stringify([state.declared.status, state.declared.name, state.active, state.doors.map((d) => [d.name, d.reachable, d.tls])]);
      if (summary !== last) {
        last = summary;
        log(`[netget] main server: declared ${state.declared.status}${state.declared.name ? ` ${state.declared.name}` : ''}`
          + `${state.declared.reason ? ` (${state.declared.reason})` : ''}; active ${state.active ?? 'none'}`
          + `${active ? ` (reachable ${active.reachable}, tls ${active.tls}${active.reason ? `, ${active.reason}` : ''})` : ''}`);
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
