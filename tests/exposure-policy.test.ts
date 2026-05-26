import assert from 'node:assert/strict';
import {
    DEFAULT_NETGET_EXPOSURE_POLICY,
    resolveNetGetExposurePolicy,
} from '../src/runtime/exposurePolicy.ts';

const defaultPolicy = resolveNetGetExposurePolicy();
assert.equal(defaultPolicy.visibility, 'loopback');
assert.equal(defaultPolicy.network.allowLoopback, true);
assert.equal(defaultPolicy.network.allowLan, false);
assert.equal(defaultPolicy.network.allowWan, false);
assert.equal(defaultPolicy.auth.requiredForControl, true);
assert.equal(defaultPolicy.auth.requiredForDestructive, true);

const lanPolicy = resolveNetGetExposurePolicy({
    appDeclaredPolicy: {
        visibility: 'lan',
        inbound: {
            bindHosts: ['suis-macbook-air.local', 'local.netget', 'local.netget'],
            paths: ['/monads/files', '/monads/files'],
        },
    },
});

assert.equal(lanPolicy.visibility, 'lan');
assert.equal(lanPolicy.network.allowLoopback, true);
assert.equal(lanPolicy.network.allowLan, true);
assert.equal(lanPolicy.network.allowWan, false);
assert.deepEqual(lanPolicy.inbound.bindHosts, ['local.netget', 'suis-macbook-air.local']);
assert.deepEqual(lanPolicy.inbound.paths, ['/monads/files']);

const destructivePolicy = resolveNetGetExposurePolicy({
    appDeclaredPolicy: {
        auth: {
            mode: 'none',
            requiredForRead: false,
            requiredForControl: false,
            requiredForDestructive: false,
        },
        control: {
            read: true,
            control: true,
            destructive: true,
        },
    },
});

assert.equal(destructivePolicy.auth.mode, 'session');
assert.equal(destructivePolicy.auth.requiredForControl, true);
assert.equal(destructivePolicy.auth.requiredForDestructive, true);

const invalidDomainPolicy = resolveNetGetExposurePolicy({
    appDeclaredPolicy: {
        publishMode: 'domain',
        inbound: {
            allowHttp: true,
            allowHttps: false,
        },
    },
});

assert.equal(invalidDomainPolicy.enabled, false);
assert.equal(DEFAULT_NETGET_EXPOSURE_POLICY.visibility, 'loopback');

console.log('exposure-policy ok');
