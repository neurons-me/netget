import assert from 'node:assert/strict';

// The older admin screens send no admin session, so the gateway refuses their mutating actions (401 from the
// gateway, 403 from nginx for a caller that is not this machine). They must say why and what to do instead.
const { isRefusal, refusalMessage } = await import('../src/htmls/Netget-REACT/frontend_local/src/utils/adminAccess.js');

assert.equal(isRefusal({ status: 401 }), true);
assert.equal(isRefusal({ status: 403 }), true);
for (const status of [200, 400, 404, 500, 502]) assert.equal(isRefusal({ status }), false, String(status));
assert.equal(isRefusal(undefined), false);

const cases: Array<[string, any, RegExp]> = [
  ['add-domain', undefined, /`netget`.*Domains/],
  ['delete-domain', undefined, /`netget`.*Domains/],
  ['provision-cert', { domain: 'example.com' }, /`netget provision-cert example\.com`/],
  ['provision-cert', undefined, /`netget provision-cert <domain>`/],
  ['domain-metadata', undefined, /no CLI command for this yet/],
  ['openresty-restart', undefined, /`netget reload`/],
  ['openresty-stop', undefined, /`netget stop`/],
  ['frontend-mode', undefined, /`netget frontend-mode <mode>`/],
  ['something-else', undefined, /`netget` CLI on the server/],
];
for (const [action, ctx, expected] of cases) {
  const message = refusalMessage(action, ctx);
  assert.match(message, expected, action);
  assert.match(message, /needs an admin session/, `${action} says why`);
  assert.match(message, /Cleaker shell/, `${action} says where it is going`);
}

console.log('frontend-admin-refusal.test.ts: all assertions passed');
