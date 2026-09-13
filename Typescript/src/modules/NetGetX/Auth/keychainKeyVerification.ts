/**
 * keychainKeyVerification.ts
 *
 * The ONE real way this codebase checks "is this signature genuinely from
 * an active key in this namespace's own keychain, right now" — shared by
 * gatewaySetupSession.ts's claim verification and adminSession.ts's
 * session verification, so both consult the SAME live source, the same
 * way, rather than two implementations that could quietly drift.
 *
 * Never trusts a client-supplied public key, authorization status, or
 * identityHash — always fetches the REAL, CURRENT key record from the
 * claimant's own keychain. The origin to fetch it from is the CALLER's
 * job to resolve and pass in (e.g. gatewaySetupSession.ts resolves it via
 * topologyResolver.ts's resolveSurface(), which finds whichever monad
 * currently serves the namespace in question) — this file no longer
 * assumes "netget's own monad" is where every namespace's keychain lives.
 * That assumption only ever held when netget's own monad and the
 * operator's namespace happened to be colocated by nginx config; it broke
 * the moment a real namespace was served by a genuinely different monad.
 */

import crypto from 'crypto';

export interface KeychainKeyLookup {
  publicKey: string;
  authorization: 'active' | 'revoked';
  /** Whose claim `namespace` actually resolves to — independent of the
   *  key's own existence. A key being active under `namespace`'s keychain
   *  proves the key belongs to that NAMESPACE's branch; it says nothing
   *  on its own about which identityHash a caller claims to be, since
   *  namespace and identityHash are bound only via the claim record. Both
   *  must be checked by the caller of this function. */
  claimIdentityHash: string | null;
}

/**
 * Fetches the REAL, current key record from the claimant's own keychain,
 * plus the claim's own identityHash for that namespace — from `origin`,
 * whichever monad the caller has already resolved to be the one actually
 * serving `namespace`.
 */
export async function fetchKeychainKey(origin: string, namespace: string, keyId: string): Promise<KeychainKeyLookup | null> {
  const url = `${origin.replace(/\/+$/, '')}/api/v1/keychain/keys/${encodeURIComponent(keyId)}?namespace=${encodeURIComponent(namespace)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const key = body?.key;
    if (!key || typeof key.publicKey !== 'string') return null;
    return {
      publicKey: key.publicKey,
      authorization: key.authorization === 'active' ? 'active' : 'revoked',
      claimIdentityHash: typeof body?.claimIdentityHash === 'string' ? body.claimIdentityHash : null,
    };
  } catch {
    return null;
  }
}

// Keychain key records (modules/monad's claim/keychain.ts) store public keys
// as SPKI PEM -- deliberately, so replay.ts's isNamespaceWriteAuthorized can
// hand them straight to crypto.createPublicKey(). `.me`'s own
// verifyEd25519Signature expects the OTHER convention this codebase also
// uses (a raw 32-byte key, base64url) -- the one GatewayClaimsSnapshot's
// `pubkeys` map and nginx's Lua auth path expect. A fetched keychain key is
// always PEM, so it's verified here the same way replay.ts already does
// (crypto.createPublicKey + crypto.verify).
export function verifyEd25519SignatureFromPem(publicKeyPem: string, message: string, signature: string): boolean {
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    const payload = Buffer.from(message, 'utf8');
    const sig = Buffer.from(String(signature || ''), 'base64');
    return crypto.verify(null, payload, key, sig);
  } catch {
    return false;
  }
}

/** Converted to the raw form only when a caller needs to WRITE it into a
 *  consumer that expects that encoding (e.g. bootstrapOwner()'s snapshot,
 *  which nginx's Lua auth path reads) -- keeping each consumer's own
 *  expected encoding intact rather than picking one and hoping every
 *  reader tolerates it. */
export function pemToRawEd25519PublicKeyBase64Url(publicKeyPem: string): string | null {
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    const der = key.export({ type: 'spki', format: 'der' }) as Buffer;
    // Fixed 12-byte SPKI prefix (RFC 8410) + 32 raw key bytes.
    if (der.length !== 44) return null;
    return der.subarray(der.length - 32).toString('base64url');
  } catch {
    return null;
  }
}
