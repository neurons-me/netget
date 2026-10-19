// gateways.js -- the gateways this panel can look at: the one it is served from ("este netget") and the ones the
// operator adds by an EXPLICIT address. Nothing is discovered, nothing is added by itself.
//
// A session for a gateway is that gateway's own: it is stored under that gateway's origin and only ever sent to it.
// Storage is injected (localStorage in the panel, a Map in tests); nothing here reads `window`.

export const LOCAL_ID = 'local';
const LIST_KEY = 'netget:gateways';
const SELECTED_KEY = 'netget:gateway-selected';
const LOCAL_TOKEN_KEY = 'netget:admin-session-token'; // the key the rest of this panel (LogsView sign-in) already uses
const remoteTokenKey = (origin) => `netget:admin-session-token:${origin}`;

const LOCAL_LABEL = 'Este netget';

function isPrivateOrLocalHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.local')
    || /^127(\.\d{1,3}){3}$/.test(h) || /^10(\.\d{1,3}){3}$/.test(h) || /^192\.168(\.\d{1,3}){2}$/.test(h)
    || /^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/.test(h);
}

/**
 * An address the operator typed, as the origin of a gateway: { ok, origin, host } or { ok: false, reason }.
 * No scheme means https, except for this machine / a private network / a .local name, which are http (the
 * gateway there has no certificate). Credentials, a path, a query or a fragment are refused: the origin is the address.
 */
export function normalizeGatewayAddress(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'Escribe la dirección del gateway.' };
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    const host = candidate.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    candidate = `${isPrivateOrLocalHost(host) ? 'http' : 'https'}://${candidate}`;
  }
  let url;
  try { url = new URL(candidate); } catch { return { ok: false, reason: 'Esa dirección no es válida.' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'Solo http o https.' };
  if (url.username || url.password) return { ok: false, reason: 'La dirección no puede llevar usuario ni contraseña.' };
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return { ok: false, reason: 'Es la dirección del gateway, sin ruta: por ejemplo https://netget.site' };
  }
  if (!url.hostname) return { ok: false, reason: 'Falta el host.' };
  return { ok: true, origin: url.origin, host: url.host };
}

function readList(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(LIST_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((g) => g && typeof g.origin === 'string' && typeof g.id === 'string') : [];
  } catch { return []; }
}

/** The local gateway first (always), then the ones that were added. `pageOrigin` is where this panel is served from. */
export function loadGateways(storage, pageOrigin = '') {
  return [{ id: LOCAL_ID, label: LOCAL_LABEL, origin: '', display: pageOrigin || 'este origen', local: true }, ...readList(storage).map((g) => ({
    id: g.id, label: g.label || new URL(g.origin).host, origin: g.origin, display: g.origin, local: false,
  }))];
}

export function addGateway(storage, address, label, pageOrigin = '') {
  const checked = normalizeGatewayAddress(address);
  if (!checked.ok) return checked;
  if (pageOrigin && checked.origin === pageOrigin) return { ok: false, reason: 'Ese es este mismo netget: ya está en la lista.' };
  const list = readList(storage);
  if (list.some((g) => g.origin === checked.origin)) return { ok: false, reason: 'Ese gateway ya está en la lista.' };
  const id = `gw-${checked.host.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const entry = { id, origin: checked.origin, label: String(label || '').trim() || checked.host };
  storage.setItem(LIST_KEY, JSON.stringify([...list, entry]));
  return { ok: true, gateway: entry };
}

export function removeGateway(storage, id) {
  if (id === LOCAL_ID) return { ok: false, reason: 'El netget local no se quita.' };
  const list = readList(storage);
  const gone = list.find((g) => g.id === id);
  if (!gone) return { ok: false, reason: 'No está en la lista.' };
  storage.setItem(LIST_KEY, JSON.stringify(list.filter((g) => g.id !== id)));
  storage.removeItem(remoteTokenKey(gone.origin)); // its session goes with it
  if (storage.getItem(SELECTED_KEY) === id) storage.removeItem(SELECTED_KEY);
  return { ok: true };
}

export function selectedGatewayId(storage, pageOrigin = '') {
  const id = storage.getItem(SELECTED_KEY) || LOCAL_ID;
  return loadGateways(storage, pageOrigin).some((g) => g.id === id) ? id : LOCAL_ID;
}
export function selectGateway(storage, id) {
  if (id === LOCAL_ID) storage.removeItem(SELECTED_KEY); else storage.setItem(SELECTED_KEY, id);
}

/** The session for THIS gateway only (null when there is none). */
export function sessionFor(storage, gateway) {
  const key = gateway.local ? LOCAL_TOKEN_KEY : remoteTokenKey(gateway.origin);
  const value = storage.getItem(key);
  return value ? String(value) : null;
}
export function saveSession(storage, gateway, token) {
  const key = gateway.local ? LOCAL_TOKEN_KEY : remoteTokenKey(gateway.origin);
  const clean = String(token || '').trim();
  if (clean) storage.setItem(key, clean); else storage.removeItem(key);
}

/** A request to a gateway: its own origin, its own session, never another's. */
export function gatewayRequest(gateway, path, init = {}, token = null) {
  const url = `${gateway.local ? '' : gateway.origin}${path}`;
  const headers = { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return { url, init: { ...init, headers } };
}

/**
 * What identifies the gateway AND the session an answer was asked with. An asynchronous answer is applied only while this
 * is still the one on screen (a late answer from the gateway that was left is dropped, not shown as the new one's).
 */
export function scopeKey(gateway, token) {
  return `${gateway && gateway.id ? gateway.id : ''}\u0000${token || ''}`;
}
