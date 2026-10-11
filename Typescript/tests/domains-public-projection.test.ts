import assert from 'node:assert/strict';

// What leaves on an anonymous GET /domains: an explicit allow-list, so a field added to the record later is out
// until somebody lists it. The default is "not public".
const { publicDomainView, PUBLIC_DOMAIN_FIELDS } = await import('../src/gateway/domainsProjection.mjs');

assert.deepEqual([...PUBLIC_DOMAIN_FIELDS], ['domain', 'type', 'subdomain']);

const record = {
  domain: 'neurons.me', type: 'static', subdomain: '', sslMode: 'manual',
  target: '/mnt/neuroverse/sites/neurons.me/current',
  sslCertificate: '/etc/letsencrypt/live/neurons.me/fullchain.pem',
  sslCertificateKey: '/etc/letsencrypt/live/neurons.me/privkey.pem',
  email: 'ops@example.org', projectPath: '/home/admin/app', owner: 'netget',
  semanticPath: 'users.netget.domains.neurons__DOT__me',
  someFutureField: 'internal',
};
const view = publicDomainView(record);
assert.deepEqual(view, { domain: 'neurons.me', type: 'static', tlsConfigured: true });
for (const leaked of ['target', 'sslCertificate', 'sslCertificateKey', 'sslMode', 'email', 'projectPath', 'owner', 'semanticPath', 'someFutureField']) {
  assert.equal(leaked in view, false, `${leaked} does not leave`);
}
// a subdomain relationship is a name, so it stays; empty values are not invented
assert.deepEqual(publicDomainView({ domain: 'a.example.com', type: 'proxy', subdomain: 'example.com', sslMode: 'letsencrypt' }), { domain: 'a.example.com', type: 'proxy', subdomain: 'example.com', tlsConfigured: true });
// tlsConfigured is a plain yes/no from the mode (configuration, not a verified certificate or HTTPS check), never the mode or a path
assert.equal(publicDomainView({ domain: 'x', sslMode: 'none' }).tlsConfigured, false);
assert.equal(publicDomainView({ domain: 'x', sslMode: 'off' }).tlsConfigured, false);
assert.equal(publicDomainView({ domain: 'x' }).tlsConfigured, false);
assert.equal(publicDomainView({ domain: 'x', sslMode: 'LetsEncrypt' }).tlsConfigured, true);
// garbage in, nothing out
assert.deepEqual(publicDomainView(null as any), { tlsConfigured: false });
assert.deepEqual(publicDomainView('x' as any), { tlsConfigured: false });
console.log('domains-public-projection: ok');
