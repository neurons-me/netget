import assert from 'node:assert/strict';

// Which of the bundle's three jobs a page gets, from where it was loaded and
// what the monad said about itself (window.__MONAD_NAMESPACE_PROVIDER_BOOT__).
const { readProviderBoot, isGatewayMonad, frontendRole, namespaceEndpoint, GATEWAY_MODULE } =
  await import('../src/htmls/Netget-REACT/frontend_local/src/session/providerBoot.js');

assert.equal(GATEWAY_MODULE, 'netget/gateway');

const namespaceBoot = { namespace: 'cleaker.me', modules: [] };
const gatewayBoot = { namespace: 'netget.site', modules: ['netget/gateway'] };

// the boot
assert.equal(readProviderBoot({ __MONAD_NAMESPACE_PROVIDER_BOOT__: namespaceBoot } as any), namespaceBoot);
assert.equal(readProviderBoot({} as any), null);
assert.equal(readProviderBoot({ __MONAD_NAMESPACE_PROVIDER_BOOT__: 'x' } as any), null);
assert.equal(readProviderBoot(undefined as any), null);
assert.equal(isGatewayMonad(gatewayBoot), true);
assert.equal(isGatewayMonad(namespaceBoot), false);
assert.equal(isGatewayMonad({ namespace: 'x' }), false, 'a boot from a monad that predates modules is not a gateway');
assert.equal(isGatewayMonad(null), false);

// the role
assert.equal(frontendRole({ host: 'local.cleaker', boot: null }), 'cleaker');
assert.equal(frontendRole({ host: 'local.host', boot: null }), 'host');
assert.equal(frontendRole({ host: 'cleaker.me', boot: namespaceBoot }), 'cleaker');
assert.equal(frontendRole({ host: 'www.cleaker.me', boot: namespaceBoot }), 'cleaker', 'www is the namespace');
assert.equal(frontendRole({ host: 'ana.cleaker.me', boot: { namespace: 'ana.cleaker.me', modules: [] } }), 'cleaker');
assert.equal(frontendRole({ host: 'netget.site', boot: gatewayBoot }), 'gateway');
assert.equal(frontendRole({ host: 'netget.site', boot: null }), 'gateway', 'nginx-served: no monad, so the admin screens');
assert.equal(frontendRole({ host: 'local.netget', boot: null }), 'gateway');

// the namespace's own address, on the scheme and port the page came over
assert.equal(namespaceEndpoint(namespaceBoot, { protocol: 'https:', port: '', origin: 'https://www.cleaker.me' }), 'https://cleaker.me');
assert.equal(namespaceEndpoint(namespaceBoot, { protocol: 'http:', port: '8162', origin: 'http://127.0.0.1:8162' }), 'http://cleaker.me:8162');
assert.equal(namespaceEndpoint(null, { protocol: 'https:', port: '', origin: 'https://x.example' }), 'https://x.example');
assert.equal(namespaceEndpoint(namespaceBoot, null), '');

console.log('frontend-provider-boot.test.ts: all assertions passed');
