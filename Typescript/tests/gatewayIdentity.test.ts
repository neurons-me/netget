/**
 * Tests for GatewayIdentity.
 *
 * NetGet must not generate a local gateway keypair. The gateway owner identity
 * is the deterministic `.me` identity hash derived from SEED.
 */

import assert from 'node:assert/strict';
import ME from 'this.me';
import {
    deriveGatewayIdentity,
    ensureGatewayIdentity,
} from '../src/modules/NetGetX/Auth/GatewayIdentity.ts';

function meIdentityHash(seed: string): string {
    const runtime = new (ME as any)(seed);
    return String(runtime['!'].identity().hash);
}

const seedA = 'netget-owner-seed-alpha';
const seedB = 'netget-owner-seed-beta';

{
    const identity = deriveGatewayIdentity(seedA);
    assert.equal(identity.identityHash, meIdentityHash(seedA));
    assert.equal(identity.seedEnv, 'SEED');
    assert.equal(identity.expression, null);
    assert.match(identity.identityHash, /^[0-9a-f]{64}$/);
}

{
    const first = deriveGatewayIdentity(seedA);
    const second = deriveGatewayIdentity(seedA);
    assert.equal(second.identityHash, first.identityHash, 'same seed produces same identityHash');
}

{
    const first = deriveGatewayIdentity(seedA);
    const second = deriveGatewayIdentity(seedB);
    assert.notEqual(second.identityHash, first.identityHash, 'different seeds produce different identityHash');
}

{
    const previous = process.env.SEED;
    process.env.SEED = seedA;
    try {
        assert.equal(ensureGatewayIdentity().identityHash, meIdentityHash(seedA));
    } finally {
        if (previous === undefined) delete process.env.SEED;
        else process.env.SEED = previous;
    }
}

{
    const previous = process.env.SEED;
    delete process.env.SEED;
    try {
        assert.throws(() => ensureGatewayIdentity(), /SEED is required/);
    } finally {
        if (previous === undefined) delete process.env.SEED;
        else process.env.SEED = previous;
    }
}

console.log('gateway-identity ok');
