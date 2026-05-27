/**
 * @module GatewayIdentity
 * @memberof module:NetGetX.Auth
 *
 * Resolves the NetGet gateway identity from `.me`.
 *
 * NetGet does not generate or persist a gateway keypair. The gateway owner is
 * the deterministic `.me` identity hash derived from the operator seed:
 *
 * ```text
 * SEED
 *   -> this.me identity()
 *   -> keccak256("this.me/identity:v1::" + seed)
 * ```
 *
 * Signing/proof material stays in `.me` (`me.prove(...)`). NetGet stores only
 * claims that reference the resolved `identityHash`.
 *
 * @see {@link module:NetGetX.Auth.GatewayClaimsManager}
 */

import ME from 'this.me';

const GATEWAY_SEED_ENV = 'SEED';

export interface GatewayIdentityInfo {
    /** 64-char `.me` identity hash derived from the configured seed. */
    identityHash: string;
    /** Active `.me` expression, when the runtime has one selected. */
    expression: string | null;
    /** Environment variable used as the seed source. */
    seedEnv: typeof GATEWAY_SEED_ENV;
}

function readGatewaySeed(seed = process.env[GATEWAY_SEED_ENV]): string {
    const value = String(seed || '').trim();
    if (!value) {
        throw new Error(`${GATEWAY_SEED_ENV} is required to derive the NetGet gateway identity from .me.`);
    }
    return value;
}

export function deriveGatewayIdentity(seed = process.env[GATEWAY_SEED_ENV]): GatewayIdentityInfo {
    const runtime = new (ME as any)(readGatewaySeed(seed));

    // me['!'].identity() is the reflective runtime contract for the root identity.
    const identity = (runtime as any)?.['!']?.identity?.();
    const hash = String(identity?.hash || '').trim();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
        throw new Error('.me did not expose a valid identity hash.');
    }

    const expression = identity?.expression ?? null;

    return {
        identityHash: hash,
        expression: expression == null ? null : String(expression),
        seedEnv: GATEWAY_SEED_ENV,
    };
}

export function ensureGatewayIdentity(): GatewayIdentityInfo {
    return deriveGatewayIdentity();
}
