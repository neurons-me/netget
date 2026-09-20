// What a monad tells the page it serves (window.__MONAD_NAMESPACE_PROVIDER_BOOT__,
// injected by monad.ai when it hands out index.html) and what this app makes of it.
//
// One bundle, three jobs, decided by where it was loaded:
//   cleaker  the landing of a namespace (this.gui's CleakerLanding)
//   host     this machine's own dashboard (local.host)
//   gateway  netget's admin screens
//
// A monad that mounts netget/gateway is a gateway's monad; any other monad
// serving this bundle serves a namespace, so its front door is the landing.
// The namespace comes from the monad (www.cleaker.me is answered as
// cleaker.me), never from guessing at the address bar.

export const GATEWAY_MODULE = 'netget/gateway';

export function readProviderBoot(win = typeof window !== 'undefined' ? window : undefined) {
  const boot = win && win.__MONAD_NAMESPACE_PROVIDER_BOOT__;
  return boot && typeof boot === 'object' ? boot : null;
}

export function isGatewayMonad(boot) {
  return Array.isArray(boot && boot.modules) && boot.modules.includes(GATEWAY_MODULE);
}

export function frontendRole({ host, boot }) {
  if (host === 'local.cleaker') return 'cleaker';
  if (host === 'local.host') return 'host';
  if (boot && !isGatewayMonad(boot)) return 'cleaker';
  return 'gateway';
}

// The address of the namespace itself, on the scheme and port the page was
// loaded over: https://cleaker.me even when the page came from www.cleaker.me.
export function namespaceEndpoint(boot, loc) {
  const namespace = String((boot && boot.namespace) || '').trim();
  if (!namespace || !loc) return (loc && loc.origin) || '';
  return `${loc.protocol}//${namespace}${loc.port ? `:${loc.port}` : ''}`;
}
