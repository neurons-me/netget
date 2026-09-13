/**
 * gatewaySetupSession.ts
 *
 * The one shared bootstrap service behind "claim this gateway" — called
 * in-process by the CLI (`netget init` / `netget claim`) and over HTTP by
 * the browser (routes/setupSession.js). Both interfaces call these exact
 * functions; neither has its own parallel validation logic. That's the
 * actual mechanism behind "CLI and browser use the same service and the
 * same validations" — not a policy, a shared module.
 *
 * State lives in `runtime/setup-session.json` (chmod 600, atomic
 * tmp+rename — same convention as GatewayClaimsManager's own snapshot
 * file), not in an in-memory Map, because the CLI and the long-running
 * Express backend are separate OS processes that can't share a Map.
 *
 * Two functions of a claim are kept deliberately separate, per the actual
 * security requirement this implements:
 *   - The SETUP CODE proves the caller has access to the install process
 *     (whoever ran `netget init`/`netget claim`, or was told the code by
 *     someone who did). It is a temporary, single-purpose access gate —
 *     not a seed, not a recovery phrase, not a password. It is never
 *     stored in plaintext (only its hash) and never appears in a URL or a
 *     log line.
 *   - The SIGNATURE (a real Ed25519 proof over a server-issued challenge,
 *     signed by an active key in the claimant's OWN Cleaker keychain — see
 *     packages/GUI/Typescript's keychainClient.ts's signWithKeychainKey)
 *     proves who becomes owner. Only this, verified here, ever assigns
 *     ownership. No identity is derived fresh from a username/password for
 *     this — the recoverable keychain identity is reused as-is.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizeProofMessage } from 'this.me';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';
import { resolveSurface } from '../../../kernel/topologyResolver.js';
import { getMonadName } from '../../../kernel/netgetMonadProcess.js';
import { GatewayClaimsManager } from './GatewayClaimsManager.js';
import { fetchKeychainKey, verifyEd25519SignatureFromPem, pemToRawEd25519PublicKeyBase64Url } from './keychainKeyVerification.js';
import { getMonadStatus, issueInstallationAuthorization, readMonadRecord } from 'monad.ai';

const SESSION_FILENAME = 'setup-session.json';
const LOCK_FILENAME = 'gateway-claim.lock';
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const CODE_LENGTH = 8;
// No 0/O/1/I/L — a human reading this off a terminal or typing it into a
// phone shouldn't have to guess which glyph a font rendered.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface SetupSessionRecord {
  gatewayId: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attemptsRemaining: number;
  unlocked: boolean;
  setupTokenHash: string | null;
  challenge: string | null;
  consumed: boolean;
  /** Anti mix-up token (same role as OAuth's `state`): minted alongside
   *  the challenge, travels through the ENTIRE round trip (netget ->
   *  Cleaker -> back to netget) as a plain, non-secret value, and must
   *  come back unchanged on the exact session that issued it. The
   *  challenge/signature binds a signature to an OPERATION; this binds a
   *  RETURN to the SPECIFIC browser session/attempt that started it —
   *  a different, necessary guarantee (see commitSignedClaim's own use
   *  of it for why one doesn't substitute for the other). */
  state: string | null;
  /** The origin+path this session's caller declared it will return to,
   *  validated and recorded at issueClaimChallenge() time — see that
   *  function's own comment for what's actually enforced here and why. */
  callbackOrigin: string | null;
  callbackPath: string | null;
}

export interface SetupSessionInfo {
  code: string;
  expiresAt: number;
}

export type VerifyCodeResult =
  | { ok: true; setupToken: string }
  | { ok: false; message: string };

export type ChallengeResult =
  // gatewayId travels with the challenge because the browser's next step
  // is building a redirect to the Cleaker origin that actually signs it
  // (CleakerNetgetClaimView) — that view needs to know which gateway it's
  // signing a claim for, and this is the one place the client already has
  // a live round-trip to ask. `state` is the anti mix-up token — see
  // SetupSessionRecord's own doc comment; the caller must carry it through
  // to Cleaker (as a URL param, never inside the signed payload) and it
  // must come back unchanged in the returned proof.
  | { ok: true; challenge: string; gatewayId: string; state: string }
  | { ok: false; message: string };

/**
 * What the browser sends after signing with a real keychain key
 * (packages/GUI/Typescript's keychainClient.ts's signWithKeychainKey) —
 * deliberately NOT `.me`'s raw prove() shape anymore. `namespace` +
 * `identityHash` name whose keychain to check; `keyId` names which entry
 * in it; the server reconstructs the exact canonical message itself (see
 * commitSignedClaim below) rather than trusting a client-supplied one.
 * `state` is round-tripped separately from the signed fields (see
 * SetupSessionRecord) — it proves WHICH attempt this return belongs to,
 * not WHAT is being claimed, so it was never part of what got signed.
 */
export interface ClaimProof {
  namespace: string;
  identityHash: string;
  keyId: string;
  signature: string;
  timestamp: number;
  state: string;
}


export type CommitResult =
  | { ok: true; ownerUsername: string }
  | { ok: false; message: string };

/**
 * Confirms `surfaceUrl` (whatever resolveSurface() resolved namespace to)
 * is genuinely THIS netget's own locally-managed monad — the one process
 * this exact netget instance spawned via startNetgetMonad()/startMonadProcess()
 * and therefore controls the stateDir of — before this function writes an
 * installation authorization straight into that process's own local state.
 *
 * Comparing origins alone is not enough (a different process can end up
 * listening on the same port after a crash, and resolveSurface() is a
 * general-purpose namespace->monad resolver with no reason to only ever
 * point at netget's own monad): this also requires the CURRENT live
 * record's own pid to still be alive and healthy, reusing the exact
 * primitives monad.ai's own process management already exposes
 * (readMonadRecord/getMonadStatus — no new liveness check invented here).
 * If any of this can't be confirmed, the caller must not proceed down this
 * path at all -- no HTTP bootstrap call is ever sent to an unverified
 * destination; there is no "try anyway, let the remote reject it" fallback.
 */
async function verifyOwnMonadSurface(surfaceUrl: string): Promise<{ ok: true; stateDir: string } | { ok: false; reason: string }> {
  let ownRecord;
  try {
    ownRecord = await readMonadRecord(getMonadName());
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Could not read this installation\'s own monad record.' };
  }
  if (!ownRecord) {
    return { ok: false, reason: 'This installation has no locally-managed monad on record to authorize a first bootstrap against.' };
  }

  let ownOrigin: string;
  let targetOrigin: string;
  try {
    ownOrigin = new URL(ownRecord.endpoint).origin;
    targetOrigin = new URL(surfaceUrl).origin;
  } catch {
    return { ok: false, reason: 'Could not parse the target surface or this installation\'s own monad endpoint.' };
  }
  if (ownOrigin !== targetOrigin) {
    return { ok: false, reason: 'The namespace resolved to a surface that is not this installation\'s own locally-managed monad.' };
  }

  const status = await getMonadStatus(ownRecord);
  if (!status.pidAlive || !status.healthy) {
    return { ok: false, reason: 'This installation\'s own monad process is not currently alive and healthy.' };
  }

  return { ok: true, stateDir: ownRecord.stateDir };
}

function getSessionPath(): string {
  return path.join(getNetgetDataDir(), 'runtime', SESSION_FILENAME);
}

function getLockPath(): string {
  return path.join(getNetgetDataDir(), 'runtime', LOCK_FILENAME);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// Both operands are hex digests of the same fixed-length hash, so a
// length check is never the thing that leaks timing — this genuinely is
// constant-time for the comparison that matters.
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Same idea as safeEqualHex, for values that aren't hex (the base64url
// `state` token) — a length mismatch alone is never the leak here either,
// since state isn't secret in the way the setup code is (it travels in a
// URL), this is just consistent hygiene, not load-bearing secrecy.
function safeEqualUtf8(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function readSession(): SetupSessionRecord | null {
  try {
    const raw = fs.readFileSync(getSessionPath(), 'utf8');
    return JSON.parse(raw) as SetupSessionRecord;
  } catch {
    return null;
  }
}

function writeSession(record: SetupSessionRecord): void {
  const outPath = getSessionPath();
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmpPath, outPath);
  try {
    fs.chmodSync(outPath, 0o600);
  } catch {
    // Non-fatal — matches ledgerIdentity.ts's/GatewayClaimsManager's own
    // tolerance for filesystems that don't support chmod semantics.
  }
}

/**
 * Starts a new setup window, invalidating any prior pending one (a fresh
 * `netget init`/`netget claim` always wins — matches monad's memoryStore.ts
 * one-nonce-per-user simplicity, there's no reason to juggle more than one
 * pending claim attempt at a time).
 */
export function createSetupSession(
  gatewayId: string,
  ttlMs = DEFAULT_TTL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): SetupSessionInfo {
  const code = randomCode(CODE_LENGTH);
  const now = Date.now();
  const record: SetupSessionRecord = {
    gatewayId,
    codeHash: sha256Hex(code),
    createdAt: now,
    expiresAt: now + ttlMs,
    attemptsRemaining: maxAttempts,
    unlocked: false,
    setupTokenHash: null,
    challenge: null,
    consumed: false,
    state: null,
    callbackOrigin: null,
    callbackPath: null,
  };
  writeSession(record);
  return { code, expiresAt: record.expiresAt };
}

function loadLiveSession(): SetupSessionRecord | null {
  const record = readSession();
  if (!record) return null;
  if (record.consumed) return null;
  if (Date.now() > record.expiresAt) return null;
  return record;
}

/**
 * Verifies a setup code and, on success, issues a `setupToken` — a second,
 * separate secret the caller holds for the rest of the flow instead of
 * re-presenting the code. Attempts are decremented and persisted on every
 * wrong guess; exhausting them invalidates the session outright (the only
 * way back in is a fresh `netget init`/`netget claim`).
 */
export function verifySetupCode(code: string): VerifyCodeResult {
  const record = loadLiveSession();
  if (!record) return { ok: false, message: 'No active setup session. Run netget init or netget claim.' };
  if (record.attemptsRemaining <= 0) return { ok: false, message: 'Too many attempts. Run netget init or netget claim again.' };

  const submittedHash = sha256Hex(String(code || '').trim());
  if (!safeEqualHex(submittedHash, record.codeHash)) {
    record.attemptsRemaining -= 1;
    writeSession(record);
    return { ok: false, message: `Incorrect code. ${record.attemptsRemaining} attempt(s) left.` };
  }

  const setupToken = crypto.randomBytes(24).toString('base64url');
  record.unlocked = true;
  record.setupTokenHash = sha256Hex(setupToken);
  writeSession(record);
  return { ok: true, setupToken };
}

function requireUnlockedSession(setupToken: string): SetupSessionRecord | null {
  const record = loadLiveSession();
  if (!record || !record.unlocked || !record.setupTokenHash) return null;
  if (!safeEqualHex(sha256Hex(String(setupToken || '')), record.setupTokenHash)) return null;
  return record;
}

/**
 * Read-only version of requireUnlockedSession for routes that only need to
 * know "does this request belong to an active, unlocked setup session" —
 * e.g. the OpenResty install/progress routes, reachable before a gateway
 * has an owner (so no admin scopes exist yet to check instead). Never
 * consumes or mutates the session; safe to call repeatedly (a progress-
 * polling loop calls this on every tick).
 */
export function isSetupSessionActive(setupToken: string): boolean {
  return requireUnlockedSession(setupToken) !== null;
}

// GatewaySetup.tsx's real production mount is netget's own root path
// (App.jsx: `<Route path="/" element={<GatewayEntry />} />`). The one
// deliberate exception is the disposable `cleakerHome` demo pilot
// (packages/GUI/Typescript/demo/cleakerHome.main.tsx), which reserves "/"
// for the real, unmodified CleakerLanding and mounts GatewaySetup at
// "/netget" instead — netgetSetupClient.ts's `returnPath` override exists
// specifically for that caller. This is still a real, exhaustive
// allowlist, not a placeholder standing in for a bigger registry: a
// caller declaring any other return path is refused HERE, at issue time,
// before a challenge (or a state token) is even minted for it.
const ALLOWED_CLAIM_RETURN_PATHS = ['/', '/netget'];

/**
 * Issues the challenge the identity must sign, plus the anti mix-up
 * `state` token that binds the LATER return to THIS specific attempt
 * (see SetupSessionRecord's doc comment for the distinction from the
 * challenge/signature). Also validates and records the exact callback
 * (origin + path) this session will return to.
 *
 * `returnOrigin`/`returnPath` are the caller's OWN current location
 * (`window.location.origin`/`.pathname` in the browser; the CLI has no
 * meaningful equivalent and never calls this the same way, since it
 * can't sign locally anyway — see bootstrapWizard.cli.ts). Validated,
 * not blindly trusted: the path must be one of this gateway's real
 * mount points, and the origin must at least be a well-formed one.
 * Real protection against a substituted callback is `state`, checked in
 * commitSignedClaim — this is what makes "no aceptes otro callback
 * enviado en el retorno" actually hold, since commitSignedClaim never
 * gets to see the browser's current URL at all, only whatever `state`
 * comes back in the proof.
 */
export function issueClaimChallenge(setupToken: string, returnOrigin: string, returnPath: string): ChallengeResult {
  const record = requireUnlockedSession(setupToken);
  if (!record) return { ok: false, message: 'Setup session is invalid or has expired.' };

  const normalizedPath = String(returnPath || '').trim() || '/';
  if (!ALLOWED_CLAIM_RETURN_PATHS.includes(normalizedPath)) {
    return { ok: false, message: 'That return path is not allowed for this gateway.' };
  }
  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(String(returnOrigin || '')).origin;
  } catch {
    return { ok: false, message: 'A valid return origin is required.' };
  }

  const challenge = normalizeProofMessage({
    purpose: 'gateway-claim',
    gatewayId: record.gatewayId,
    nonce: crypto.randomBytes(16).toString('base64url'),
    timestamp: Date.now(),
  });
  const state = crypto.randomBytes(16).toString('base64url');
  record.challenge = challenge;
  record.state = state;
  record.callbackOrigin = normalizedOrigin;
  record.callbackPath = normalizedPath;
  writeSession(record);
  return { ok: true, challenge, gatewayId: record.gatewayId, state };
}

/**
 * The commit. Every hard guarantee this feature exists for lives here:
 *   1. State binding — proves this return belongs to the SAME attempt
 *      that was issued a challenge, not a different (possibly still-live,
 *      possibly superseded) session's response landing here by mix-up or
 *      substitution. Checked before anything else — a wrong `state` means
 *      nothing downstream should even be attempted, however well-formed
 *      the rest of the proof looks.
 *   2. Session/challenge binding — the signed message is reconstructed
 *      HERE, from our own stored challenge and the claimed fields, never
 *      trusted as a client-supplied string (same "never trust a signed
 *      string at face value" principle replay.ts's
 *      isNamespaceWriteAuthorized already uses).
 *   3. Real key liveness — fetches the ACTUAL key record from the
 *      claimant's own keychain and requires `authorization === 'active'`.
 *      Never trusts a client-supplied public key. Deliberately does NOT
 *      check for `admin` — a key doesn't need to administer its owner's
 *      keychain to sign a gateway claim; those are separate
 *      authorizations (see claim/keychain.ts's own header comment for the
 *      same principle from the other side).
 *   4. Real signature verification (verifyEd25519SignatureFromPem) against
 *      the FETCHED public key, over the message this function reconstructed.
 *   5. Namespace surface resolution: resolveSurface() (topologyResolver.ts)
 *      finds which live monad actually serves `namespace` before step 3
 *      ever runs — netget no longer assumes its own monad is where every
 *      namespace's keychain lives.
 *   6. Atomic race protection: an exclusive-create lock file — the one
 *      primitive that's actually safe across the CLI's and the backend's
 *      separate OS processes, unlike an in-process mutex.
 *   7. No separate owner ledger to check for absence: authority is
 *      DERIVED from `namespace`'s own claim (steps 3-4 above already prove
 *      the caller holds it) and simply materialized locally — see
 *      GatewayClaimsManager.materializeFromNamespaceClaim()'s own doc
 *      comment for why this needs no ledger write at all.
 *   8. Persisted-check: reads the local cache back before reporting success.
 *   9. Consumes the session — bootstrap access is now permanently gone.
 */
export async function commitSignedClaim(
  setupToken: string,
  proof: ClaimProof,
): Promise<CommitResult> {
  const record = requireUnlockedSession(setupToken);
  if (!record || !record.challenge) return { ok: false, message: 'Setup session is invalid or has expired.' };

  // The state token round-trips through the browser, never through this
  // server, so an absent or mismatched one means the request in front of
  // us either isn't the response to OUR OWN challenge, or belongs to a
  // DIFFERENT (superseded or concurrent-in-spirit) attempt — reject
  // before anything else runs, including the namespace/identityHash/keyId
  // presence check below.
  const submittedState = String(proof.state || '');
  if (!record.state || !submittedState || !safeEqualUtf8(submittedState, record.state)) {
    return { ok: false, message: 'This claim does not match the setup attempt that started it.' };
  }

  const namespace = String(proof.namespace || '').trim().toLowerCase();
  const identityHash = String(proof.identityHash || '').trim();
  const keyId = String(proof.keyId || '').trim();
  if (!namespace || !identityHash || !keyId) {
    return { ok: false, message: 'Claim is missing namespace, identityHash, or keyId.' };
  }
  // The namespace's own leading segment is its handle — e.g.
  // "suign.local.cleaker" -> "suign" — the same <handle>.<root> grammar
  // every other part of this system already uses. Derived here, not
  // taken as a separate client-supplied field, so there's one source of
  // truth for what ends up in gateway-claims.json's usernames map.
  const username = namespace.split('.')[0] || namespace;

  // Netget doesn't own a dedicated ledger for this anymore -- authority is
  // derived from `namespace`'s own real .me claim, wherever it actually
  // lives. resolveSurface() is netget's own namespace->monad discovery
  // (topologyResolver.ts, a TS port of surface_proxy.lua's own algorithm,
  // reading the same apps.json mesh registry /netget/apps already
  // surfaces) -- not a new resolution mechanism, and not something this
  // function gets to skip: without it there is no honest way to know
  // which keychain to check next.
  //
  // KNOWN, PRE-EXISTING LIMIT this inherits rather than introduces (see
  // CLAUDE.md's "Known architectural gaps" #2, "surface_proxy.lua ranks
  // trust, it does not verify claims"): resolveSurface()'s answer is only
  // as trustworthy as apps.json's own trust-tier reduction, which is
  // built from UNAUTHENTICATED, self-reported heartbeats (identity_hash
  // is a public string, string-compared, never cryptographically proven
  // at report time -- see netgetRegistration.ts / apps.lua's
  // derive_trust()). Today that's contained: registration is enforced
  // loopback-only on both the client (netgetRegistration.ts's
  // LOCAL_NETGET_HOSTS allowlist) and the server (apps.lua's
  // is_local_request()), so spoofing this resolution requires code
  // execution on THIS SAME machine already, not a remote attacker. That
  // containment is exactly what a real cross-host mesh (a different
  // machine's monad legitimately reporting here) would have to remove --
  // so closing gap #2 with signed heartbeats is a hard prerequisite
  // BEFORE any cross-host work lands, not an optional hardening pass.
  // Do not read the loopback restriction as this function's own
  // safeguard; it belongs to netgetRegistration.ts/apps.lua and this
  // function has no independent check of its own.
  const surface = await resolveSurface({ namespace });
  if (!surface) {
    return { ok: false, message: 'Could not find a live surface serving that namespace.' };
  }

  const expectedMessage = normalizeProofMessage({
    op: 'netget-claim-gateway',
    gatewayId: record.gatewayId,
    namespace,
    identityHash,
    keyId,
    challenge: record.challenge,
    timestamp: proof.timestamp,
  });

  const keychainKey = await fetchKeychainKey(surface.url, namespace, keyId);
  if (!keychainKey) {
    return { ok: false, message: 'Could not find that key in the claiming identity\'s keychain.' };
  }
  if (keychainKey.authorization !== 'active') {
    return { ok: false, message: 'That key has been revoked and can no longer sign a claim.' };
  }
  // The key being active under `namespace`'s keychain only proves it
  // belongs to that namespace's branch — it does NOT by itself prove
  // `namespace` belongs to the `identityHash` being asserted as the new
  // owner. Without this check, anyone holding an active key under their
  // OWN namespace could sign a claim asserting a DIFFERENT identityHash
  // as owner (the signature only proves key possession, not the truth of
  // whatever fields happen to be in the signed payload). The namespace's
  // own claim record is the only source of truth for that binding.
  if (!keychainKey.claimIdentityHash || keychainKey.claimIdentityHash !== identityHash) {
    return { ok: false, message: 'That namespace\'s claim does not match the asserted identity.' };
  }

  const validSignature = verifyEd25519SignatureFromPem(keychainKey.publicKey, expectedMessage, proof.signature);
  if (!validSignature) {
    return { ok: false, message: 'Signature verification failed.' };
  }

  // Validation only now (the value itself is no longer forwarded) — confirms
  // the key material is genuinely well-formed Ed25519 SPKI before bothering
  // the target surface with a network call. The gateway-authority bootstrap
  // endpoint independently derives and stores the PEM form itself from the
  // SAME live keychain key it looks up on its own.
  if (!pemToRawEd25519PublicKeyBase64Url(keychainKey.publicKey)) {
    return { ok: false, message: 'Could not read that key\'s public key material.' };
  }

  const lockPath = getLockPath();
  try {
    fs.writeFileSync(lockPath, String(Date.now()), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, message: 'A claim is already in progress. Refresh to see the current owner.' };
    }
    throw error;
  }

  try {
    // Authority for this gateway is derived from `namespace`'s own real
    // .me claim (already proven above -- the signature verified against
    // the key `namespace`'s claim record itself says is active), but it is
    // no longer cached ONLY locally: this forwards the SAME already-
    // verified proof (challenge/identityHash/keyId/signature) to the
    // target monad's own signed `claim/gatewayAuthority.ts` bootstrap
    // endpoint, which re-verifies it INDEPENDENTLY (never trusting that
    // netget already checked) and persists the canonical owner/admins
    // record in `.me` itself. Netget then just reads that confirmed state
    // back (materializeFromGatewayAuthority) to refresh the local cache
    // Lua consumes -- netget needs read access here, never write
    // permission. See GatewayClaimsManager.materializeFromGatewayAuthority's
    // own doc comment, and CLAUDE.md's gap #5 for why the OLD
    // materializeFromNamespaceClaim()-only path was retired from this flow
    // (its local-only cache could no longer authorize grant/revoke/transfer
    // afterwards).
    //
    // Before that forward: this monad's own bootstrap gate additionally
    // requires proof the caller passed THIS installation's own authorized
    // setup (installationAuthorization.ts) -- a valid namespace claim + key
    // is no longer sufficient on its own for the first bootstrap of a
    // gatewayId (see gatewayAuthority.ts's own header comment for why).
    // That proof is this exact setup-code ceremony, already completed
    // above (requireUnlockedSession) -- extending its reach here, rather
    // than inventing a second mechanism. It's written DIRECTLY into the
    // target monad's own local state directory, never over the network, so
    // reaching this point first REQUIRES confirming the target really is
    // this netget's own locally-managed monad process -- a stale/wrong/
    // remote surface must never receive a write into what would be a
    // COMPLETELY DIFFERENT process's stateDir path, and must never let the
    // bootstrap call go out at all if that can't be confirmed (no "try
    // anyway, let the remote reject it" fallback here).
    const ownSurface = await verifyOwnMonadSurface(surface.url);
    if (!ownSurface.ok) {
      return { ok: false, message: `Could not verify the target surface before authorizing this gateway's bootstrap: ${ownSurface.reason}` };
    }
    const authIssued = issueInstallationAuthorization({
      stateDir: ownSurface.stateDir,
      gatewayId: record.gatewayId,
      namespace,
      identityHash,
      // Reuses this exact setup session's OWN remaining vigencia, rather
      // than a second, independent clock — the authorization can never
      // outlive the setup ceremony that's supposed to have produced it.
      expiresAt: record.expiresAt,
    });
    if (!authIssued.ok) {
      return { ok: false, message: `Could not authorize this installation's first bootstrap (${authIssued.error}).` };
    }

    const bootstrapUrl = `${surface.url.replace(/\/+$/, '')}/api/v1/gateway/${encodeURIComponent(record.gatewayId)}/bootstrap`;
    let bootstrapBody: { ok?: boolean; error?: string } | null = null;
    try {
      const bootstrapRes = await fetch(bootstrapUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          namespace, identityHash, keyId, challenge: record.challenge, timestamp: proof.timestamp, signature: proof.signature, username,
        }),
      });
      bootstrapBody = await bootstrapRes.json().catch(() => null);
      if (!bootstrapRes.ok || !bootstrapBody?.ok) {
        if (bootstrapBody?.error === 'ALREADY_BOOTSTRAPPED') {
          return { ok: false, message: `Gateway "${record.gatewayId}" is already bound to a different identity.` };
        }
        return { ok: false, message: `Could not bind this gateway to that namespace (${bootstrapBody?.error || bootstrapRes.status}).` };
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not reach the target surface to bind this gateway.' };
    }

    // Explicit record.gatewayId, not the default (hostname-derived) one:
    // the remote canonical branch is keyed by whatever gatewayId THIS
    // setup session actually bootstrapped (createSetupSession's own
    // caller decides that — e.g. resolveLedgerIdentity().id in real
    // usage), which the manager's bare default constructor has no way to
    // know. Read and write must target the identical id.
    const mgr = new GatewayClaimsManager(record.gatewayId, { ledger: false });
    await mgr.materializeFromGatewayAuthority(surface.url);

    const persisted = mgr.read();
    if (persisted?.owner !== identityHash) {
      return { ok: false, message: 'Claim did not persist — try again.' };
    }

    record.consumed = true;
    writeSession(record);
    return { ok: true, ownerUsername: username };
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Non-fatal — a missing lock file at cleanup time changes nothing.
    }
  }
}

