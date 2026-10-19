// gatewayProbe.js -- what a gateway tells THIS panel, and what this panel may do there. Every statement carries how it
// was learned; what could not be determined is "unknown", not a guess.
//
//  * what can be QUERIED: the gateway's public reads, each tried and classified.
//  * what may be MODIFIED: asked of the gateway itself, with the session for that gateway, by a request its capability
//    gate answers BEFORE its handler looks at the body: POST /add-domain with an empty object. No session: 401. A session
//    without gateway:write: 403. A session that may: 400 "domain is required" -- the handler refused an empty request,
//    so nothing was written. No domain name is ever sent.
import { gatewayRequest } from './gateways.js';

const PUBLIC_READS = [
  { path: '/gateway-identity', label: 'Identidad del gateway' },
  { path: '/healthcheck', label: 'Salud' },
  { path: '/main-server-namespace', label: 'Namespace principal' },
  { path: '/domains', label: 'Puertas (vista pública)' },
];

async function timed(fetchImpl, url, init, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) });
    let json = null;
    const type = res.headers?.get?.('content-type') || '';
    if (type.includes('application/json')) { try { json = await res.json(); } catch { json = null; } }
    return { ok: res.ok, status: res.status, json, type };
  } catch (error) {
    // A browser cannot tell "nothing is there" from "CORS refused it": both are a TypeError.
    return { ok: false, status: 0, json: null, type: '', error: String(error?.name === 'AbortError' ? 'timeout' : (error?.message || error)) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classify(result) {
  if (result.status === 0) {
    return result.error === 'timeout'
      ? { state: 'unreachable', detail: 'No respondió a tiempo.' }
      : { state: 'unreachable', detail: 'No se pudo alcanzar, o el navegador lo bloqueó (CORS): no se puede distinguir desde aquí.' };
  }
  if (result.status === 401 || result.status === 403) return { state: 'refused', detail: `El gateway lo rechaza (${result.status}).` };
  if (result.ok && result.json) return { state: 'ok', detail: 'Responde.' };
  if (result.ok) return { state: 'error', detail: 'Respondió algo que no es JSON (¿no es un gateway?).' };
  return { state: 'error', detail: `Respondió ${result.status}.` };
}

export async function probeGateway(gateway, { token = null, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null), timeoutMs = 6000, now = () => Date.now() } = {}) {
  const reads = await Promise.all(PUBLIC_READS.map(async (read) => {
    const { url, init } = gatewayRequest(gateway, read.path, { method: 'GET', headers: { Accept: 'application/json' } }, null);
    const result = await timed(fetchImpl, url, init, timeoutMs);
    return { ...read, ...classify(result), status: result.status, json: result.json };
  }));
  const by = Object.fromEntries(reads.map((r) => [r.path, r]));
  const identity = by['/gateway-identity'].state === 'ok' ? by['/gateway-identity'].json : null;
  const domains = by['/domains'].state === 'ok' && Array.isArray(by['/domains'].json?.domains) ? by['/domains'].json.domains : null;
  const reachable = reads.some((r) => r.state === 'ok') ? true : reads.every((r) => r.state === 'unreachable') ? 'unknown' : false;

  // permissions: asked of the gateway, with the session that belongs to it
  let modify = { state: 'no', basis: 'Sin sesión para este gateway: solo lo que divulga.' };
  let readConfig = { state: 'no', basis: 'Sin sesión: la vista pública (dominio, tipo, TLS), sin destinos.' };
  if (token) {
    const { url, init } = gatewayRequest(gateway, '/add-domain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, token);
    const cap = await timed(fetchImpl, url, init, timeoutMs);
    if (cap.status === 0) modify = { state: 'unknown', basis: 'No se pudo preguntar al gateway (inalcanzable o CORS).' };
    else if (cap.status === 401) modify = { state: 'no', basis: 'El gateway no acepta esta sesión (401).' };
    else if (cap.status === 403) modify = { state: 'no', basis: 'La sesión es válida pero sin gateway:write (403): solo lectura.' };
    else if (cap.status === 400) modify = { state: 'yes', basis: 'El gateway autorizó la sesión y rechazó una petición vacía: no se escribió nada.' };
    else modify = { state: 'unknown', basis: `El gateway respondió ${cap.status}; no se pudo concluir.` };

    const list = gatewayRequest(gateway, '/domains', { method: 'GET', headers: { Accept: 'application/json' } }, token);
    const listed = await timed(fetchImpl, list.url, list.init, timeoutMs);
    const first = Array.isArray(listed.json?.domains) ? listed.json.domains[0] : null;
    if (listed.status === 0) readConfig = { state: 'unknown', basis: 'No se pudo preguntar al gateway.' };
    else if (first && Object.prototype.hasOwnProperty.call(first, 'target')) readConfig = { state: 'yes', basis: 'Con la sesión, /domains devuelve destinos y configuración.' };
    else if (first) readConfig = { state: 'no', basis: 'Con la sesión, /domains sigue devolviendo la vista pública.' };
    else readConfig = { state: 'unknown', basis: 'El gateway no tiene puertas: no hay con qué comprobarlo.' };
  }

  return {
    origin: gateway.local ? '(este origen)' : gateway.origin,
    at: now(),
    reachable,
    identity,
    domains,
    namespace: by['/main-server-namespace'].json?.namespace ?? null,
    mainServerName: by['/main-server-namespace'].json?.mainServerName ?? null,
    version: by['/healthcheck'].json?.version ?? null,
    reads: reads.map(({ json, ...rest }) => rest),
    permissions: { readConfig, modify, hasSession: Boolean(token) },
  };
}
