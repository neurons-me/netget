// domainStatus.ts -- what a domain route is doing right now, in words the panel can show without guessing.
//
// "Unknown" is a state, not a failure to render: when the gateway cannot tell (no probe, no registry, a destination kind
// it does not check), it says so. TLS is its own line: without a certificate the router cannot complete an HTTPS
// handshake for the host, so the visitor gets a TLS error and there is no page to explain it -- the panel is where that
// is said.
import { checkRouteTarget, type DestinationKind } from './routeTargets.js';

export type DestinationState = 'ok' | 'down' | 'missing' | 'unknown';
export type TlsState = 'configured' | 'pending';

export interface DomainStatusInput {
  domain: string;
  type?: string | null;
  target?: string | null;
  sslCertificate?: string | null;
  sslCertificateKey?: string | null;
  sslMode?: string | null;
}
export interface RegisteredApp { name?: string; port?: number; host?: string; lastSeenMs?: number; ttlMs?: number; metadata?: Record<string, unknown> }

export interface DomainStatusContext {
  /** Domains the router has loaded (domain-map.json), or null when the file is not there. */
  applied: ReadonlySet<string> | null;
  apps: readonly RegisteredApp[];
  now?: number;
  /** Can a TCP connection to host:port be made within the time bound? */
  probeTcp?: (host: string, port: number) => Promise<boolean>;
  /** Does this absolute path name a folder, and does it hold an index.html? */
  inspectFolder?: (path: string) => { directory: boolean; index: boolean };
}

export interface DomainStatus {
  domain: string;
  kind: DestinationKind | 'invalid';
  type: string;
  target: string;
  applied: boolean | 'unknown';
  tls: { state: TlsState; detail: string };
  destination: { state: DestinationState; detail: string };
  /** The address a visitor would use; null when it cannot work yet, with why. */
  open: { url: string | null; why: string | null };
}

function appNamed(apps: readonly RegisteredApp[], want: string): RegisteredApp | undefined {
  const w = want.toLowerCase();
  return apps.find((a) => {
    const name = String(a.name ?? '').toLowerCase();
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    return name === w || name.replace(/^monad:/, '') === w || String(meta.monadName ?? '').toLowerCase() === w;
  });
}

export async function describeDomain(row: DomainStatusInput, context: DomainStatusContext): Promise<DomainStatus> {
  const type = String(row.type ?? '').toLowerCase() || 'proxy';
  const target = String(row.target ?? '');
  const hasCert = Boolean(String(row.sslCertificate ?? '').trim() && String(row.sslCertificateKey ?? '').trim());
  const tls = hasCert
    ? { state: 'configured' as const, detail: 'La puerta tiene certificado: abre por HTTPS.' }
    : { state: 'pending' as const, detail: 'TLS pendiente: sin certificado la puerta no completa el saludo HTTPS, así que no hay página que explique nada. Aprovisiona un certificado o asigna uno.' };
  const applied: boolean | 'unknown' = context.applied === null ? 'unknown' : context.applied.has(row.domain.toLowerCase());
  const open = hasCert
    ? { url: `https://${row.domain}/`, why: null }
    : { url: null, why: 'TLS pendiente' };

  const checked = checkRouteTarget(type, target);
  if (checked.ok === false) {
    return { domain: row.domain, kind: 'invalid', type, target, applied, tls, open, destination: { state: 'unknown', detail: checked.reason } };
  }
  const base = { domain: row.domain, kind: checked.kind, type, target, applied, tls, open } as const;

  if (checked.kind === 'proxy') {
    return { ...base, destination: { state: 'unknown', detail: 'Lo resuelve el monad de este gateway; no hay destino que comprobar.' } };
  }

  if (checked.kind === 'static') {
    if (!context.inspectFolder) return { ...base, destination: { state: 'unknown', detail: 'No se comprobó la carpeta.' } };
    const seen = context.inspectFolder(checked.target);
    if (!seen.directory) return { ...base, destination: { state: 'missing', detail: `La carpeta ${checked.target} no existe: la puerta no tiene qué servir.` } };
    if (!seen.index) return { ...base, destination: { state: 'missing', detail: `La carpeta existe pero no tiene index.html.` } };
    return { ...base, destination: { state: 'ok', detail: 'La carpeta existe y tiene index.html.' } };
  }

  if (checked.kind === 'app') {
    const name = checked.target.slice(4);
    const app = appNamed(context.apps, name);
    if (!app) return { ...base, destination: { state: 'down', detail: `Ninguna app registrada se llama "${name}".` } };
    const ttl = Number(app.ttlMs ?? 45_000);
    const last = Number(app.lastSeenMs ?? 0);
    const now = context.now ?? Date.now();
    if (!(last > 0) || now - last > ttl) return { ...base, destination: { state: 'down', detail: `La app "${name}" está registrada pero no ha reportado: no está viva.` } };
    return { ...base, destination: { state: 'ok', detail: `La app "${name}" está viva.` } };
  }

  // server: host:port
  const m = /^(.*):(\d+)$/.exec(checked.target)!;
  if (!context.probeTcp) return { ...base, destination: { state: 'unknown', detail: 'No se comprobó el servicio.' } };
  let up = false;
  try { up = await context.probeTcp(m[1].replace(/^\[|\]$/g, ''), Number(m[2])); } catch { up = false; }
  return up
    ? { ...base, destination: { state: 'ok', detail: `${checked.target} acepta conexiones.` } }
    : { ...base, destination: { state: 'down', detail: `${checked.target} no acepta conexiones.` } };
}
