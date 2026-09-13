/**
 * adminSession.ts
 *
 * Real, verified admin sessions — the thing this codebase was missing.
 * /domains/metadata (and, until this file existed, /logs too) trusted
 * X-Netget-Identity/X-Netget-Scopes headers on the assumption that only
 * nginx's me_sig.lua ever sets them, after it verifies a real signature.
 * That assumption holds ONLY when a request is genuinely routed through
 * that specific nginx location — it does not hold against the bootstrap
 * port (proxy.js, port 3000) or against monad.ai's own HTTP surface,
 * both of which this exact codebase already reaches directly elsewhere
 * in this session's own work (openresty/install, and now logs). A caller
 * hitting either of those directly can set ANY header it wants; nothing
 * there was ever verifying a signature at all.
 *
 * This closes that gap for one route (`/logs`) with a real, minimal
 * challenge/response session, verified against the LIVE keychain — see
 * keychainKeyVerification.ts's fetchKeychainKey(). A first version of
 * this file verified against GatewayClaimsManager's own `pubkeys`
 * map instead — a snapshot frozen at claim/grantAdmin time, never
 * updated by a later key rotation. That was wrong: it would keep
 * accepting a since-REVOKED key, and would refuse a genuinely-active
 * NEW key the same identity rotated to. Every verification here now
 * re-fetches the actual, current key record — the same live source
 * gatewaySetupSession.ts's own claim verification already consults, not
 * a second, divergent notion of "this key is fine."
 *
 * Sessions carry their signing key forward, on purpose: resolveAdminSession()
 * re-checks that SAME key's live authorization on every call, not just at
 * issuance. Explicit decision, not an oversight — a session survives its
 * own TTL (30 min) but does NOT survive its signing key being revoked;
 * the moment an operator revokes a key, every session that key ever
 * signed for stops working on its very next request, before the TTL
 * would have ended it anyway. isAdmin()/getScopes() are re-checked fresh
 * for the same reason (a revoked ADMIN, not just a revoked key, must
 * lose access immediately too).
 */

import crypto from 'crypto';
import { fetchKeychainKey, verifyEd25519SignatureFromPem } from './keychainKeyVerification.js';
import { GatewayClaimsManager } from './GatewayClaimsManager.js';
import { resolveSurface } from '../../../kernel/topologyResolver.js';

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

interface AdminSessionRecord {
  identityHash: string;
  namespace: string;
  keyId: string;
  expiresAt: number;
}

const pendingChallenges = new Map<string, PendingChallenge>();
const sessions = new Map<string, AdminSessionRecord>();

export interface IssueChallengeResult {
  ok: boolean;
  challenge?: string;
  message?: string;
}

export function issueAdminSessionChallenge(identityHash: string, claims: GatewayClaimsManager = new GatewayClaimsManager()): IssueChallengeResult {
  const id = String(identityHash || '').trim();
  if (!id) return { ok: false, message: 'identityHash is required' };
  if (!claims.isAdmin(id)) return { ok: false, message: 'NOT_AN_ADMIN' };

  const challenge = crypto.randomBytes(24).toString('base64url');
  pendingChallenges.set(id, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { ok: true, challenge };
}

export interface VerifyChallengeResult {
  ok: boolean;
  sessionToken?: string;
  message?: string;
}

/**
 * `signature` is verified over the raw challenge string, nothing else —
 * deliberately minimal (no timestamp/nonce composed in) since the
 * challenge itself is single-use, random, and short-lived; composing more
 * fields in would add no real protection here, only ceremony.
 *
 * `namespace`/`keyId` identify WHICH live keychain key is being used to
 * sign — never trusted at face value: fetchKeychainKey() fetches the
 * REAL, current record, and this function requires (a) it's `active`
 * right now, and (b) `namespace`'s own claim actually resolves to
 * `identityHash` (the same binding check gatewaySetupSession.ts's claim
 * verification uses, for the identical reason: an active key only proves
 * it belongs to `namespace`'s branch, not that `namespace` belongs to
 * the identity asserting it).
 */
export async function verifyAdminSessionChallenge(
  identityHash: string,
  namespace: string,
  keyId: string,
  signature: string,
  claims: GatewayClaimsManager = new GatewayClaimsManager(),
): Promise<VerifyChallengeResult> {
  const id = String(identityHash || '').trim();
  const pending = pendingChallenges.get(id);
  if (!pending) return { ok: false, message: 'NO_PENDING_CHALLENGE' };
  if (Date.now() > pending.expiresAt) {
    pendingChallenges.delete(id);
    return { ok: false, message: 'CHALLENGE_EXPIRED' };
  }
  if (!claims.isAdmin(id)) return { ok: false, message: 'NOT_AN_ADMIN' };

  const surface = await resolveSurface({ namespace });
  if (!surface) return { ok: false, message: 'NAMESPACE_SURFACE_NOT_FOUND' };

  const keychainKey = await fetchKeychainKey(surface.url, namespace, keyId);
  if (!keychainKey) return { ok: false, message: 'KEY_NOT_FOUND' };
  if (keychainKey.authorization !== 'active') return { ok: false, message: 'KEY_REVOKED' };
  if (!keychainKey.claimIdentityHash || keychainKey.claimIdentityHash !== id) {
    return { ok: false, message: 'NAMESPACE_IDENTITY_MISMATCH' };
  }

  const validSignature = verifyEd25519SignatureFromPem(keychainKey.publicKey, pending.challenge, String(signature || ''));
  if (!validSignature) return { ok: false, message: 'INVALID_SIGNATURE' };

  // Single-use: a replayed signature over the same challenge must not
  // mint a second session once this one's consumed it.
  pendingChallenges.delete(id);

  const sessionToken = crypto.randomBytes(32).toString('base64url');
  sessions.set(sessionToken, { identityHash: id, namespace, keyId, expiresAt: Date.now() + SESSION_TTL_MS });
  return { ok: true, sessionToken };
}

export interface ResolvedAdminSession {
  identityHash: string;
  scopes: string[];
}

/**
 * Re-checks THREE things fresh on every call, never trusting what was
 * true at issuance: the session's own TTL, the signing key's CURRENT
 * live authorization (fetchKeychainKey again — a session outlives its
 * own key being revoked by exactly zero requests), and isAdmin()/
 * getScopes() against the current claims snapshot (an admin revoked
 * after issuing a session loses access on the very next request, not
 * only once the session's TTL runs out).
 */
export async function resolveAdminSession(token: string, claims: GatewayClaimsManager = new GatewayClaimsManager()): Promise<ResolvedAdminSession | null> {
  const t = String(token || '').trim();
  if (!t) return null;
  const record = sessions.get(t);
  if (!record) return null;
  if (Date.now() > record.expiresAt) {
    sessions.delete(t);
    return null;
  }
  if (!claims.isAdmin(record.identityHash)) return null;

  const surface = await resolveSurface({ namespace: record.namespace });
  if (!surface) {
    sessions.delete(t);
    return null;
  }
  const keychainKey = await fetchKeychainKey(surface.url, record.namespace, record.keyId);
  if (!keychainKey || keychainKey.authorization !== 'active') {
    // The signing key was revoked (or vanished) since this session was
    // issued -- the session dies with it, immediately, not at its TTL.
    sessions.delete(t);
    return null;
  }

  return { identityHash: record.identityHash, scopes: claims.getScopes(record.identityHash) };
}
