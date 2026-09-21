import assert from 'node:assert/strict';

// Which of the bundle's three jobs a page gets, from where it was loaded and
// what the monad said about itself (window.__MONAD_NAMESPACE_PROVIDER_BOOT__).
const { readProviderBoot, isGatewayMonad, frontendRole, hostIsNamespace, namespaceEndpoint, transportOriginFor, bootNamespaceRoot, rootNamespaceOf, GATEWAY_MODULE } =
  await import('../src/htmls/Netget-REACT/frontend_local/src/session/providerBoot.js');

assert.equal(GATEWAY_MODULE, 'netget/gateway');

const namespaceBoot = { namespace: 'cleaker.me', modules: [] };
const gatewayBoot = { namespace: 'netget.site', modules: ['netget/gateway'] };
// one monad that is both: it serves the cleaker.me namespace AND mounts the gateway
const bothBoot = { namespace: 'cleaker.me', modules: ['netget/gateway'] };

// the boot
assert.equal(readProviderBoot({ __MONAD_NAMESPACE_PROVIDER_BOOT__: namespaceBoot } as any), namespaceBoot);
assert.equal(readProviderBoot({} as any), null);
assert.equal(readProviderBoot({ __MONAD_NAMESPACE_PROVIDER_BOOT__: 'x' } as any), null);
assert.equal(readProviderBoot(undefined as any), null);
assert.equal(isGatewayMonad(gatewayBoot), true);
assert.equal(isGatewayMonad(namespaceBoot), false);
assert.equal(isGatewayMonad({ namespace: 'x' }), false, 'a boot from a monad that predates modules is not a gateway');
assert.equal(isGatewayMonad(null), false);

// which hosts are the namespace's own
assert.equal(hostIsNamespace('cleaker.me', bothBoot), true);
assert.equal(hostIsNamespace('www.cleaker.me', bothBoot), true);
assert.equal(hostIsNamespace('ana.cleaker.me', bothBoot), true);
assert.equal(hostIsNamespace('netget.site', bothBoot), false);
assert.equal(hostIsNamespace('notcleaker.me', bothBoot), false, 'a suffix of the name is not a subdomain');
assert.equal(hostIsNamespace('cleaker.me', null), false);

// the role
// -- one monad that is the namespace AND the gateway: the address decides
assert.equal(frontendRole({ host: 'cleaker.me', boot: bothBoot }), 'cleaker');
assert.equal(frontendRole({ host: 'www.cleaker.me', boot: bothBoot }), 'cleaker');
assert.equal(frontendRole({ host: 'ana.cleaker.me', boot: bothBoot }), 'cleaker');
assert.equal(frontendRole({ host: 'netget.site', boot: bothBoot }), 'gateway', 'the gateway host still gets the admin screens');
assert.equal(frontendRole({ host: 'local.cleaker', boot: null }), 'cleaker');
assert.equal(frontendRole({ host: 'local.host', boot: null }), 'host');
assert.equal(frontendRole({ host: 'cleaker.me', boot: namespaceBoot }), 'cleaker');
assert.equal(frontendRole({ host: 'www.cleaker.me', boot: namespaceBoot }), 'cleaker', 'www is the namespace');
assert.equal(frontendRole({ host: 'ana.cleaker.me', boot: { namespace: 'ana.cleaker.me', modules: [] } }), 'cleaker');
// a gateway whose namespace IS its own host: that host is a namespace host too, and the
// Cleaker app it gets reaches the gateway at /netget. (The admin screens are what a host
// served without a monad -- nginx's static file -- gets.)
assert.equal(frontendRole({ host: 'netget.site', boot: gatewayBoot }), 'cleaker');
assert.equal(frontendRole({ host: 'admin.example', boot: gatewayBoot }), 'gateway', 'a host that is not the namespace');
assert.equal(frontendRole({ host: 'netget.site', boot: null }), 'gateway', 'nginx-served: no monad, so the admin screens');
assert.equal(frontendRole({ host: 'local.netget', boot: null }), 'gateway');

// the namespace's own address, on the scheme and port the page came over
assert.equal(namespaceEndpoint(namespaceBoot, { protocol: 'https:', port: '', origin: 'https://www.cleaker.me' }), 'https://cleaker.me');
assert.equal(namespaceEndpoint(namespaceBoot, { protocol: 'http:', port: '8162', origin: 'http://127.0.0.1:8162' }), 'http://cleaker.me:8162');
// At a handle host the boot's `namespace` is the HANDLE's own; the root is `rootNamespace`. The endpoint, and the root a
// credential claims under, name the root -- composing from the handle's namespace made jabellae.jabellae.cleaker.me.
const handleBoot = { ...namespaceBoot, namespace: 'jabellae.cleaker.me', rootNamespace: 'cleaker.me', handle: 'jabellae' };
assert.equal(rootNamespaceOf(handleBoot), 'cleaker.me');
assert.equal(rootNamespaceOf({ ...namespaceBoot, rootNamespace: undefined }), namespaceBoot.namespace, 'a monad older than the field only has namespace');
assert.equal(namespaceEndpoint(handleBoot, { protocol: 'https:', port: '', origin: 'https://jabellae.cleaker.me' }), 'https://cleaker.me');
assert.equal(bootNamespaceRoot(handleBoot, 'jabellae.cleaker.me'), 'cleaker.me');
assert.equal(namespaceEndpoint(null, { protocol: 'https:', port: '', origin: 'https://x.example' }), 'https://x.example');
assert.equal(namespaceEndpoint(namespaceBoot, null), '');

// where the session talks: the gateway's monad through /apps/netget, or the
// namespace's own monad at the address the page came from
const at = (origin: string) => ({ origin, protocol: 'https:', port: '' });
assert.equal(transportOriginFor(null, at('https://netget.site')), 'https://netget.site/apps/netget');
assert.equal(transportOriginFor(gatewayBoot, at('https://netget.site')), 'https://netget.site/apps/netget');
assert.equal(transportOriginFor({ ...namespaceBoot, apiOrigin: 'https://www.cleaker.me' }, at('https://www.cleaker.me')), 'https://www.cleaker.me');
assert.equal(transportOriginFor(namespaceBoot, at('https://cleaker.me')), 'https://cleaker.me', 'no apiOrigin: the page origin');
// a boot may only restate the origin that served the client; another origin is ignored, not followed
assert.equal(transportOriginFor({ ...namespaceBoot, apiOrigin: 'https://evil.example' }, at('https://cleaker.me')), 'https://cleaker.me');
assert.equal(transportOriginFor({ ...namespaceBoot, apiOrigin: 'https://cleaker.me' }, at('https://www.cleaker.me')), 'https://www.cleaker.me', 'www is another origin: the session stays where the client was served');
assert.equal(transportOriginFor({ ...namespaceBoot, apiOrigin: 'http://cleaker.me' }, at('https://cleaker.me')), 'https://cleaker.me', 'a downgraded scheme is not followed');
// the combined monad: its namespace's hosts talk to it directly, the gateway host through /apps/netget
assert.equal(transportOriginFor({ ...bothBoot, apiOrigin: 'https://cleaker.me' }, { origin: 'https://cleaker.me', hostname: 'cleaker.me' }), 'https://cleaker.me');
assert.equal(transportOriginFor(bothBoot, { origin: 'https://netget.site', hostname: 'netget.site' }), 'https://netget.site/apps/netget');

// the root a credential claims under
assert.equal(bootNamespaceRoot(namespaceBoot), 'cleaker.me');
assert.equal(bootNamespaceRoot(gatewayBoot), '');
assert.equal(bootNamespaceRoot(bothBoot, 'cleaker.me'), 'cleaker.me', 'the combined monad, on its namespace');
assert.equal(bootNamespaceRoot(bothBoot, 'netget.site'), '', 'the combined monad, on the gateway host');
assert.equal(bootNamespaceRoot(null), '');

console.log('frontend-provider-boot.test.ts: all assertions passed');
