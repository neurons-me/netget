// The real dependencies of session/gatewayCapabilities.js: this netget's own gateway, the identity's proof, the write probe.
import { deriveCleakerNodeFromMe, fetchGatewayHostname, signedRequest } from 'this.gui/cleaker';
import { probeModify } from '../utils/gatewayProbe.js';

// localStorage, or a memory stand-in where the browser refuses it (private modes): the scope and the resolvers read the same one.
export const browserStorage = (() => {
  try {
    const s = window.localStorage;
    s.getItem('netget:probe');
    return s;
  } catch {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
})();

export const gatewayDeps = {
  fetchHostname: fetchGatewayHostname,
  deriveNode: deriveCleakerNodeFromMe,
  signedRequest,
  probeModify,
};
