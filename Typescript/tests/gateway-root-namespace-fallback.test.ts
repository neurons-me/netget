/**
 * Regression test: getGatewayRootNamespace() must never fall back to the
 * physical machine hostname. A host is a surface, never a namespace (see
 * modules/cleaker/Typescript/typedocs/Namespace-Is-Context.md) — falling
 * back to os.hostname() silently derives a "namespace" from wherever this
 * process happens to be running, exactly the category error that doc rules
 * out. The correct unconfigured default is the literal designated local
 * namespace "local.cleaker", which stays in place until an operator
 * explicitly picks something else via NETGET_MONAD_NAMESPACE or
 * mainServer.cli.ts's mainServerName (xConfig).
 */

import assert from 'node:assert/strict';
import os from 'node:os';

const ENV_KEY = 'NETGET_MONAD_NAMESPACE';
const originalEnv = process.env[ENV_KEY];

try {
    delete process.env[ENV_KEY];

    // Fresh import so getGatewayRootNamespace() reads its module-level
    // mainServerName cache in its default (never-loaded) state — this test
    // deliberately never calls loadGatewayRootNamespaceCache(), so the
    // "no configuration at all" path is what's under test here.
    const { getGatewayRootNamespace } = await import('../src/kernel/netgetMonadProcess.ts');

    const unconfigured = getGatewayRootNamespace();
    assert.equal(
        unconfigured,
        'local.cleaker',
        'unconfigured getGatewayRootNamespace() must default to the designated local namespace "local.cleaker"',
    );
    assert.notEqual(
        unconfigured,
        os.hostname().toLowerCase(),
        'getGatewayRootNamespace() must never fall back to the physical hostname — host is not namespace',
    );

    // An explicit override still wins over the default.
    process.env[ENV_KEY] = 'cleaker.me';
    assert.equal(getGatewayRootNamespace(), 'cleaker.me');
} finally {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
}

console.log('gateway-root-namespace-fallback ok');
