import { useSyncExternalStore } from 'react';
import { onGatewayChange } from '../utils/gateways.js';
import { gatewayScope } from './gatewayCapabilities.js';

// Which gateway is selected and which admin session is stored for it, as the one string the shell resolves capabilities for.
// Selecting a gateway, adding or removing one, or storing/removing a session (here or in another tab) changes it.
const subscribe = (notify) => {
  const off = onGatewayChange(notify);
  window.addEventListener('storage', notify);
  return () => { off(); window.removeEventListener('storage', notify); };
};

const read = () => {
  try { return gatewayScope(window.localStorage, window.location.origin); } catch { return 'local|-'; }
};

export function useGatewayScope() {
  return useSyncExternalStore(subscribe, read, () => 'local|-');
}
