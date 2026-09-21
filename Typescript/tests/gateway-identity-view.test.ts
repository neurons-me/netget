import assert from 'node:assert/strict';

// What GatewayCard is given from a /gateway-identity body: a fact the response did not report is `undefined`
// (the card says "unavailable"), never a value that means something else (0, false, "unclaimed", "not set").
import { gatewayCardPropsFromIdentity as view } from '../gui/src/compounds/GatewayDashboard/identityView';

const full = view({
  gatewayId: 'gw-1', hostname: 'vm', bootstrapped: true, owner: 'abc123', ownerUsername: 'jabellae',
  adminCount: 1, scopes: ['grant', 'revoke'], updatedAt: 1758500000000, scheme: 'https', port: 443, ip: '10.0.0.5',
});
assert.equal(full.gatewayId, 'gw-1');
assert.equal(full.bootstrapped, true);
assert.equal(full.owner, 'abc123');
assert.equal(full.adminCount, 1);
assert.deepEqual(full.scopes, ['grant', 'revoke']);

// an empty answer (or one that is not an object) reports nothing: no zero, no "unclaimed", no "not set"
for (const empty of [{}, null, undefined, [], 'text', 42]) {
  const v = view(empty);
  assert.equal(v.gatewayId, undefined, `${JSON.stringify(empty)}: gatewayId`);
  assert.equal(v.bootstrapped, undefined, `${JSON.stringify(empty)}: bootstrapped is not false`);
  assert.equal(v.adminCount, undefined, `${JSON.stringify(empty)}: adminCount is not 0`);
  assert.equal(v.owner, undefined, `${JSON.stringify(empty)}: owner is not null`);
  assert.equal(v.scopes, undefined, `${JSON.stringify(empty)}: scopes is not []`);
}

// explicit values keep their meaning
assert.equal(view({ bootstrapped: false }).bootstrapped, false, 'false stays false (unclaimed)');
assert.equal(view({ adminCount: 0 }).adminCount, 0, 'an explicit 0 stays 0');
assert.equal(view({ owner: null }).owner, null, 'null owner: the gateway said it has none');
assert.deepEqual(view({ scopes: [] }).scopes, [], 'an explicit empty list stays empty');

// malformed values are treated as not reported
assert.equal(view({ gatewayId: '   ' }).gatewayId, undefined);
assert.equal(view({ gatewayId: 7 }).gatewayId, undefined);
assert.equal(view({ bootstrapped: 'true' }).bootstrapped, undefined);
assert.equal(view({ bootstrapped: 1 }).bootstrapped, undefined);
for (const bad of [-1, 1.5, '2', NaN, null]) assert.equal(view({ adminCount: bad }).adminCount, undefined, `adminCount ${String(bad)}`);
assert.equal(view({ owner: '' }).owner, undefined);
assert.equal(view({ owner: 5 }).owner, undefined);
assert.equal(view({ scopes: 'grant' }).scopes, undefined);
assert.deepEqual(view({ scopes: ['a', 3, null, 'b'] }).scopes, ['a', 'b'], 'non-string scopes are dropped');

console.log('gateway-identity-view.test.ts: all assertions passed');
