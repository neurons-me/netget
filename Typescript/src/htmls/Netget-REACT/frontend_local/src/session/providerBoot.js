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

// What the boot calls `namespace` is the one THIS ADDRESS resolves to: the root at cleaker.me and
// www.cleaker.me, but the handle's own at jabellae.cleaker.me. The root every handle lives under is
// `rootNamespace`. Composing a handle's namespace from `namespace` is what produced
// jabellae.jabellae.cleaker.me. A monad older than this field only ever had `namespace`.
export function rootNamespaceOf(boot) {
  return String((boot && (boot.rootNamespace || boot.namespace)) || '').trim();
}

export function readProviderBoot(win = typeof window !== 'undefined' ? window : undefined) {
  const boot = win && win.__MONAD_NAMESPACE_PROVIDER_BOOT__;
  return boot && typeof boot === 'object' ? boot : null;
}

export function isGatewayMonad(boot) {
  return Array.isArray(boot && boot.modules) && boot.modules.includes(GATEWAY_MODULE);
}

// Is this page loaded from the namespace the monad serves -- its root, www, or a
// handle under it (cleaker.me, www.cleaker.me, ana.cleaker.me)?
export function hostIsNamespace(host, boot) {
  const ns = String((boot && boot.namespace) || '').trim().toLowerCase();
  const h = String(host || '').trim().toLowerCase();
  return !!ns && (h === ns || h.endsWith(`.${ns}`));
}

// One monad can be both a namespace and the gateway (its identities and the
// gateway's authority must live on the same monad), so the monad alone does not
// say which screens a page gets -- the address does: the namespace's own hosts
// get the Cleaker app (which reaches the gateway at /netget), any other host
// the monad answers for (netget.site) the admin screens.
export function frontendRole({ host, boot }) {
  if (host === 'local.cleaker') return 'cleaker';
  if (host === 'local.host') return 'host';
  if (boot) {
    if (hostIsNamespace(host, boot)) return 'cleaker';
    if (!isGatewayMonad(boot)) return 'cleaker';
  }
  return 'gateway';
}

// The address of the namespace itself, on the scheme and port the page was
// loaded over: https://cleaker.me even when the page came from www.cleaker.me.
export function namespaceEndpoint(boot, loc) {
  const namespace = rootNamespaceOf(boot);
  if (!namespace || !loc) return (loc && loc.origin) || '';
  return `${loc.protocol}//${namespace}${loc.port ? `:${loc.port}` : ''}`;
}

// Where this page's session talks to its monad. Through netget's generic
// /apps/<name> proxy to the gateway's monad ("netget", the name netget has
// always given its own) -- unless the monad that served this page is a
// namespace's own, in which case it is that monad: the namespace answers for
// itself, at the address the page was loaded from.
export function transportOriginFor(boot, loc) {
  const origin = (loc && loc.origin) || '';
  const host = (loc && loc.hostname) || '';
  if (boot && (hostIsNamespace(host, boot) || !isGatewayMonad(boot))) return String(boot.apiOrigin || origin);
  return `${origin}/apps/netget`;
}

// The root a credential claims under when nothing on screen picked one: the
// namespace the monad serves, if it serves one; otherwise the caller falls back
// to the gateway's own hostname.
export function bootNamespaceRoot(boot, host) {
  if (!boot) return '';
  if (isGatewayMonad(boot) && !hostIsNamespace(host, boot)) return '';
  return rootNamespaceOf(boot);
}
