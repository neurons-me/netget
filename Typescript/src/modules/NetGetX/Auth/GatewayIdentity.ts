/**
 * @module GatewayIdentity
 * @memberof module:NetGetX.Auth
 *
 * Resolves the NetGet gateway identity from `.me`.
 *
 * NetGet does not generate or persist a gateway keypair. The gateway owner is
 * the deterministic `.me` identity hash derived from human credentials:
 *
 * ```text
 * username + secret
 *   -> compoundSeed  = keccak256("me.seed/compound:v1::" + username + "::" + secret)
 *   -> identityHash  = keccak256("this.me/identity:v1::" + compoundSeed)
 * ```
 *
 * This is the exact same derivation Cleaker performs in the browser — guaranteeing
 * that the CLI anchor and the browser login always produce the same 64-char hash
 * for the same credentials, with no network roundtrip required on either side.
 *
 * No normalization (no lowercase, no trim) is applied to the inputs — the hash
 * is sensitive to exact byte content, mirroring ME_RESEED_SYMBOL in this.me kernel.
 *
 * @see {@link module:NetGetX.Auth.GatewayClaimsManager}
 */

import ME from 'this.me';
import cleaker from 'cleaker';

// ── Symbols ───────────────────────────────────────────────────────────────────
// These are the same Symbols used internally by the this.me kernel.
// Symbol.for() guarantees identity across module boundaries.
const ME_RESEED    = Symbol.for('me.internal.reseed');
const ME_IDENTITY  = Symbol.for('me.identity');
const ME_SEED      = Symbol.for('me.seed');               // raw compound seed hex

// ── Ed25519 proof key derivation ──────────────────────────────────────────────

/**
 * Derives the Ed25519 public key for a specific identity expression on this gateway.
 *
 * This is the key that `netget claim` stamps into `gateway-claims.json` and that
 * nginx Lua uses to verify challenge-response proofs from Cleaker.
 *
 * The derivation mirrors what `me.prove()` does on the client:
 *   compoundSeed = keccak256("me.seed/compound:v1::" + who + "::" + secret)
 *   branchSeed   = HKDF(compoundSeed, "me.prove.v1", expression)   [32 bytes]
 *   Ed25519 keypair from branchSeed
 *   → return base64url(publicKey)
 *
 * The expression should be `normalizedWho` (e.g. "suign"), matching what Cleaker
 * sends as `proof.expression` in the challenge-response flow.
 *
 * @param who        - Username (lowercase, trimmed — same as passed to ME_RESEED).
 * @param secret     - Secret/password as entered by the operator.
 * @param expression - Active expression for the proof key (typically == who).
 * @returns Base64url-encoded raw Ed25519 public key (32 bytes → 43 chars).
 */
export async function deriveGatewayProofKey(
    who: string,
    secret: string,
    hostname: string,
): Promise<string> {
    // Spin up a blank kernel and seed it with the operator credentials.
    // After ME_RESEED, #activeExpression = who (the handle).
    const me = new (ME as any)();
    me[ME_RESEED](who, secret);

    // Verify the compound seed was set — Symbol.for('me.seed') exposes it.
    const seedHex = String(me[ME_SEED] ?? '').trim();
    if (!seedHex) {
        throw new Error('.me kernel did not expose a compound seed after ME_RESEED.');
    }

    // cleaker(me, namespace) — bind identity to this namespace surface.
    // This is "who am I HERE": the identity contextualised to who.hostname,
    // matching exactly what the browser's Cleaker does before calling prove().
    const node = cleaker(me, `${who}.${hostname}`);

    // Derive the Ed25519 public key for this Cleaker context.
    // prove() flow: HKDF(seed, "me.prove.v1", who) → branchSeed → keypair → publicKey.
    // challenge: null because we only need the stable public key, not a live proof.
    const proof = await (node as any).prove({ rootNamespace: hostname, challenge: null });
    return proof.publicKey as string;
}

// ── Legacy SEED-env path (kept for backward compat) ──────────────────────────
const GATEWAY_SEED_ENV = 'SEED';

export interface GatewayIdentityInfo {
    /** 64-char `.me` identity hash. */
    identityHash: string;
    /** Active `.me` expression (username), when set. */
    expression: string | null;
    /** Name of the environment variable consulted for the seed (always `'SEED'`). */
    seedEnv: string;
}

// ── Primary: derive from human credentials ────────────────────────────────────

/**
 * Derives the same `identityHash` that Cleaker produces in the browser.
 *
 * Inputs are used verbatim — no lowercase, no trim — so that the CLI and the
 * browser always hash the same bytes for the same credentials.
 *
 * @param who    - Username, normalized by caller (lowercase + trim) to match browser Cleaker behavior.
 * @param secret - Secret/password as entered by the human operator (not normalized).
 */
export function deriveIdentityFromCredentials(who: string, secret: string): string {
    // Spin up a blank kernel; the random initial seed is immediately overwritten.
    const kernel = new (ME as any)();

    // ME_RESEED computes:
    //   seed         = keccak256("me.seed/compound:v1::" + who + "::" + secret)
    //   identityHash = keccak256("this.me/identity:v1::" + seed)
    // This is the byte-exact path Cleaker follows in the browser.
    kernel[ME_RESEED](who, secret);

    const identity = kernel[ME_IDENTITY];
    const hash     = String(identity?.hash ?? '').trim();

    if (!/^[0-9a-f]{64}$/.test(hash)) {
        throw new Error('.me did not produce a valid identity hash from credentials.');
    }

    return hash;
}

// ── Legacy: derive from raw SEED env var ──────────────────────────────────────

function readGatewaySeed(seed = process.env[GATEWAY_SEED_ENV]): string {
    const value = String(seed || '').trim();
    if (!value) {
        throw new Error(`${GATEWAY_SEED_ENV} is required to derive the NetGet gateway identity from .me.`);
    }
    return value;
}

export function deriveGatewayIdentity(seed = process.env[GATEWAY_SEED_ENV]): GatewayIdentityInfo {
    const runtime  = new (ME as any)(readGatewaySeed(seed));
    const identity = runtime[ME_IDENTITY];
    const hash     = String(identity?.hash ?? '').trim();

    if (!/^[0-9a-f]{64}$/.test(hash)) {
        throw new Error('.me did not expose a valid identity hash.');
    }

    return {
        identityHash: hash,
        expression:   identity?.expression != null ? String(identity.expression) : null,
        seedEnv:      GATEWAY_SEED_ENV,
    };
}

export function ensureGatewayIdentity(): GatewayIdentityInfo {
    return deriveGatewayIdentity();
}
