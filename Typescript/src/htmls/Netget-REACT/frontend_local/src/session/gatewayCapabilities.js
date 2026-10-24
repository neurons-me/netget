// gatewayCapabilities.js -- what netget's document asks of the gateways, and how it is answered.
//
// The document declares Domains and Logs with `requires: { capability }`; the shell (this.gui) calls one resolver per capability with
// the SELECTED link, the session through it, and the app's scope. Here the scope is "which gateway is selected, and which admin
// sessions are stored". A resolver answers "should this be offered"; the gateway authorizes every request.
//
//   gateway:admin   the Domains console. This netget recognizes who is signed in through the selected link as its owner or an
//                   administrator (a signed /check-auth), OR some gateway in the list accepts the admin session stored for it. It does
//                   NOT depend on which gateway is selected: the selector lives inside that screen, and hiding the screen because the
//                   selected gateway refuses you would leave no way back. What the screen may DO is decided inside it, per selected
//                   gateway and its own session (utils/gatewayProbe.js).
//   gateway:logs    the SELECTED gateway is this netget, which recognizes that identity AND granted it the explicit scope
//                   gateway:control:logs-read (lua/handlers/logs.lua has no owner bypass). Logs are read with this machine's own proof,
//                   so a selected gateway that was added does not offer them.
//
// Nothing here reaches the network by itself: the dependencies are injected (session/gatewayCapabilitiesDefaults.js builds the real ones).
import { loadGateways, selectedGatewayId, sessionFor } from '../utils/gateways.js';

export const GATEWAY_ADMIN = 'gateway:admin';
export const GATEWAY_LOGS = 'gateway:logs';
export const LOGS_READ_SCOPE = 'gateway:control:logs-read';

// FNV-1a, 32 bit: enough to tell one set of stored sessions from another. The sessions themselves never become part of the scope.
function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** `<selected gateway id>|<fingerprint of the admin sessions stored, or ->`: changes when the selection, the list or any session does. */
export function gatewayScope(storage, pageOrigin) {
  const id = selectedGatewayId(storage, pageOrigin);
  const stored = loadGateways(storage, pageOrigin)
    .map((g) => { const token = sessionFor(storage, g); return token ? `${g.id}=${token}` : ''; })
    .filter(Boolean)
    .join('\n');
  return `${id}|${stored ? fingerprint(stored) : '-'}`;
}

const idOfScope = (scope) => String(scope || '').split('|')[0];

export function createGatewayResolvers({ storage, pageOrigin, deps }) {
  // one resolution = one `signal`: both capabilities share the answer to the same question
  const memo = new WeakMap();

  async function recognized(ctx) {
    if (!ctx.session.authenticated || !ctx.session.me) return null;
    const hostname = await deps.fetchHostname();
    const node = deps.deriveNode(ctx.session.me, hostname);
    const res = await deps.signedRequest(node, hostname, '/check-auth', { signal: ctx.signal });
    if (!res.ok) return null;
    const answer = await res.json().catch(() => null);
    return answer && answer.authenticated === true ? answer : null;
  }

  async function authorization(ctx) {
    const gateways = loadGateways(storage, pageOrigin);
    const local = gateways.find((g) => g.local);
    const selected = gateways.find((g) => g.id === idOfScope(ctx.scope)) || null;   // a scope that names a gateway that is gone selects none
    let admin = false;
    let logs = false;
    try {
      const answer = local ? await recognized(ctx) : null;
      if (answer) {
        admin = answer.isOwner === true || answer.isAdmin === true;
        logs = Boolean(selected && selected.local) && Array.isArray(answer.scopes) && answer.scopes.includes(LOGS_READ_SCOPE);
      }
    } catch { /* unreachable or refused: not recognized */ }
    if (!admin) {
      // an admin session stored for a gateway counts for THAT gateway only: it is asked of that gateway, with that gateway's token
      for (const gateway of gateways) {
        const token = sessionFor(storage, gateway);
        if (!token) continue;
        try { if ((await deps.probeModify(gateway, token)) === 'yes') { admin = true; break; } } catch { /* try the next */ }
      }
    }
    return { admin, logs };
  }

  const shared = (ctx) => {
    let pending = memo.get(ctx.signal);
    if (!pending) { pending = authorization(ctx); memo.set(ctx.signal, pending); }
    return pending;
  };

  return {
    [GATEWAY_ADMIN]: async (ctx) => (await shared(ctx)).admin,
    [GATEWAY_LOGS]: async (ctx) => (await shared(ctx)).logs,
  };
}
