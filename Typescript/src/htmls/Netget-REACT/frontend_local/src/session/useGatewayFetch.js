import { useCallback } from 'react';
import { deriveCleakerNodeFromMe, fetchGatewayHostname, signedRequest } from 'this.gui/cleaker';
import { useOptionalSeedSessionContext } from 'this.gui/react';
import { LOCAL_ID, loadGateways, selectedGatewayId, sessionFor } from '../utils/gateways.js';
import { gatewayFetch } from '../utils/gatewayFetch.js';
import { useGatewayScope } from './useGatewayScope.js';

// `request(path, init)` for the screens: a request to the SELECTED gateway with that gateway's credentials (utils/gatewayFetch.js).
// The identity is the one signed in through the SELECTED link (the shell's session); it changes when the link, the identity, the
// selected gateway or its stored session does, so what a screen asked before is asked again.
export function useGatewayFetch() {
  const scope = useGatewayScope();
  const seed = useOptionalSeedSessionContext();
  const me = seed?.authenticated ? seed.me : null;
  return useCallback(async (path, init) => {
    const storage = window.localStorage;
    const pageOrigin = window.location.origin;
    const gateways = loadGateways(storage, pageOrigin);
    const gateway = gateways.find((g) => g.id === selectedGatewayId(storage, pageOrigin)) || gateways.find((g) => g.id === LOCAL_ID);
    const token = sessionFor(storage, gateway);
    let session = null;
    if (gateway.local && me) {
      try {
        const hostname = await fetchGatewayHostname();
        session = { node: deriveCleakerNodeFromMe(me, hostname), hostname };
      } catch { session = null; }                                  // the gateway did not say who it is: go without a proof
    }
    return gatewayFetch({ gateway, token, session, signedRequest }, path, init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, me]);
}
