/**
 * ledgerIdentity.ts
 *
 * netget's own ledger — the `.me` kernel netget's monad is seeded with —
 * needs a stable identity of its own, independent of the machine's
 * hostname, whatever public domain an operator later chooses, and whoever
 * currently administers it (the gateway *owner* — see
 * GatewayClaimsManager.ts, a separate concept on purpose: the owner
 * administers this ledger, the owner is not this ledger).
 *
 * Before this file existed, the only "identity" netget's monad had was
 * `netget-gateway:<hostname>` (netgetMonadProcess.ts's old
 * resolveGatewaySeed()) — derivable by anyone who knows the machine's
 * hostname (public information, not a secret) and unstable if the host is
 * ever renamed. This module generates a real random seed exactly once,
 * persists it, and reuses it forever after — the ledger's identity no
 * longer depends on anything about the host, its configuration, or its
 * current administrator.
 *
 * Scope of this file, deliberately narrow:
 *   - ONLY the ledger's own seed material. It does not touch
 *     gateway-claims.json's `owner`, does not change how a human `.me`/
 *     Cleaker identity derives ITS OWN keys (deriveCompoundSeed,
 *     ME_RESEED, etc. — completely untouched), and this seed is never fed
 *     into any user-facing derivation. It identifies this SERVICE, not a
 *     master key for anything that hangs off it.
 *   - Existing installations are never silently migrated. If this
 *     installation already shows signs of prior use (a recorded gateway
 *     owner, or a legacy domains.db) but has no identity file yet, this
 *     resolves to the OLD hostname-derived seed unchanged — exactly what
 *     it already was — and reports `requiresMigration: true` rather than
 *     inventing a new identity that would silently orphan whatever already
 *     depended on the old one. Deciding and performing that migration is
 *     deliberately out of scope here.
 *   - A missing identity file is not treated as proof of a legacy install
 *     either. A separate, durable marker file records that THIS
 *     installation was already given a persisted identity; if the marker
 *     is present but ledger-identity.json isn't, that's data loss, and
 *     resolveLedgerIdentity() throws rather than substituting the
 *     hostname seed or generating a new identity — see that function's
 *     own doc comment.
 *
 * Storage: `<netget data dir>/ledger-identity.json`, `chmod 600`. To be
 * precise about what that is and isn't: `chmod 600` restricts which OS
 * users on this machine can read the file — it does NOT encrypt the seed
 * on disk. The seed sits there in plaintext; anyone with root, or a copy
 * of the disk/filesystem, reads it directly, chmod or not. Encrypting it
 * would need a password for an unattended service to unlock itself at
 * boot with no human present; that password would have to live reachable
 * by the same process, right next to the ciphertext, which protects
 * against nothing a full-disk copy wouldn't already expose — so it isn't
 * done here. This is a materially weaker guarantee than the
 * password-unlocked local vault a human user's own identity gets
 * (localIdentityVault.ts, packages/GUI/Typescript), which is a
 * fundamentally different threat model (a human who can type a password,
 * not an unattended process that can't).
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getNetgetDataDir } from '../utils/netgetPaths.js';

const LEDGER_IDENTITY_FILENAME = 'ledger-identity.json';
// A separate, non-secret file recording only that THIS installation was
// once given a persisted, random-seed identity — written alongside
// ledger-identity.json on every fresh install, and self-healed back if
// ever found missing while ledger-identity.json itself is present and
// valid (see resolveLedgerIdentity()). Its only job is surviving on its
// own if ledger-identity.json is later deleted or lost by itself: without
// it, a missing identity file is indistinguishable from "this installation
// never had one" (a true legacy install, safe to fall back to the old
// hostname seed) — with it, a missing identity file on an installation
// that HAD this marker unambiguously means data loss, which must halt
// startup instead of quietly substituting a different identity.
const LEDGER_IDENTITY_MARKER_FILENAME = 'ledger-identity.initialized.json';
const SEED_BYTES = 32;
const ID_BYTES = 16;
const SEED_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface LedgerIdentity {
  /** Public label, safe to log/display (e.g. `netget status`). Deliberately
   *  NOT derived from the seed — same reasoning as this.me's own
   *  identity-root.ts's rootId — so that displaying `id` never leaks
   *  anything MATHEMATICALLY computable from `seedHex`. That's the whole
   *  guarantee: `id` is just a label, not proof of anything. On its own it
   *  does not demonstrate cryptographic control of the ledger (only
   *  `seedHex` — never displayed — does that), and it is not
   *  "uncorrelated" with the seed in the sense of storage: both fields
   *  live in the same file on disk, so anyone who reads one reads the
   *  other right next to it. Non-derivability and storage-separation are
   *  two different properties — this field only gives the first. */
  id: string;
  /** 32-byte random seed, hex-encoded — the ledger's actual private
   *  identity, fed into netget's monad as SEED/ME_SEED. Never logged,
   *  never returned from any status/read-only surface. */
  seedHex: string;
  createdAt: number;
}

export interface LedgerIdentityResolution {
  seedHex: string;
  id: string;
  /** True only when this call just generated and persisted a brand-new
   *  identity — a genuinely fresh installation, confirmed by the absence
   *  of both an identity file AND any prior installation state. */
  isNew: boolean;
  /** True when this installation shows signs of prior use but has no
   *  identity file — the migration case this module deliberately leaves
   *  unresolved. `seedHex` in this case is the old hostname-derived value
   *  (unchanged behavior), never a freshly generated one. */
  requiresMigration: boolean;
}

function getLedgerIdentityPath(): string {
  return path.join(getNetgetDataDir(), LEDGER_IDENTITY_FILENAME);
}

function getLedgerIdentityMarkerPath(): string {
  return path.join(getNetgetDataDir(), LEDGER_IDENTITY_MARKER_FILENAME);
}

/**
 * Bare presence check, deliberately not a parse/shape check like
 * readIdentityFile()'s: the marker carries no secret and nothing depends
 * on its *content* being well-formed, only on the file existing at all.
 * A presence-only check can't itself be defeated by partial corruption —
 * there's no parse step to fail.
 */
function hasInitializationMarker(): boolean {
  return fs.existsSync(getLedgerIdentityMarkerPath());
}

function writeInitializationMarker(identity: LedgerIdentity): void {
  const outPath = getLedgerIdentityMarkerPath();
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify({ id: identity.id, createdAt: identity.createdAt }, null, 2), 'utf8');
  fs.renameSync(tmpPath, outPath);
}

// Deliberately duplicated one-line path joins — not imports — of
// GatewayClaimsManager.ts's getGatewayClaimsPath() and the legacy
// domains.db path domainStore.ts/surface_resolution.lua both use. This
// module sits BELOW netgetMonadProcess.ts, which both of those import;
// importing either of them here would be a circular dependency.
function getGatewayClaimsPathForDetectionOnly(): string {
  return path.join(getNetgetDataDir(), 'runtime', 'gateway-claims.json');
}

function getLegacyDomainsDbPath(): string {
  return path.join(getNetgetDataDir(), 'domains.db');
}

/**
 * True when this installation shows any sign of having run before this
 * module existed — an owner already anchored, or a legacy domains.db on
 * disk. Deliberately conservative (either signal is enough): the cost of
 * a false positive here is only "prints a migration notice and keeps
 * using the old seed a bit longer than strictly necessary"; the cost of a
 * false negative is silently generating a new ledger identity out from
 * under real existing state.
 */
function hasExistingInstallationState(): boolean {
  try {
    const raw = fs.readFileSync(getGatewayClaimsPathForDetectionOnly(), 'utf8');
    const claims = JSON.parse(raw);
    if (claims && typeof claims.owner === 'string' && claims.owner.trim()) return true;
  } catch {
    // Missing/unreadable/unparseable claims file is not itself a signal
    // either way — fall through to the other check.
  }
  return fs.existsSync(getLegacyDomainsDbPath());
}

function generateSeedHex(): string {
  return crypto.randomBytes(SEED_BYTES).toString('hex');
}

function generatePublicId(): string {
  return crypto.randomBytes(ID_BYTES).toString('hex');
}

/**
 * Three-way read result — deliberately NOT collapsed to a single
 * null/non-null, because "the file was never created" (a legacy
 * installation that predates this module — safe to fall back to the old
 * hostname-derived seed) and "the file exists but is damaged" (this
 * installation already had a persisted, random-seed identity, and that
 * identity is now unreadable — falling back would silently swap in a
 * DIFFERENT identity than the one this ledger actually had) are not the
 * same situation and must not be handled the same way. Only `absent`
 * reaches the legacy fallback below; `corrupt` always halts.
 */
type IdentityFileReadResult =
  | { status: 'valid'; identity: LedgerIdentity }
  | { status: 'corrupt' }
  | { status: 'absent' };

function readIdentityFile(): IdentityFileReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(getLedgerIdentityPath(), 'utf8');
  } catch (error) {
    // ENOENT (never created) is the only case treated as "absent" — any
    // other read failure (permission denied, I/O error, a path that's a
    // directory, etc.) means something concrete is wrong with a file that
    // does exist, which is exactly the `corrupt` case: it must halt, not
    // be treated as a fresh/legacy install.
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent' };
    }
    return { status: 'corrupt' };
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.seedHex === 'string' && SEED_HEX_PATTERN.test(parsed.seedHex) &&
      typeof parsed.id === 'string' && parsed.id.trim().length > 0 &&
      typeof parsed.createdAt === 'number'
    ) {
      return { status: 'valid', identity: { id: parsed.id, seedHex: parsed.seedHex, createdAt: parsed.createdAt } };
    }
    return { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

function writeIdentityFile(identity: LedgerIdentity): void {
  const outPath = getLedgerIdentityPath();
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(identity, null, 2), 'utf8');
  fs.renameSync(tmpPath, outPath);
  try {
    fs.chmodSync(outPath, 0o600);
  } catch {
    // Non-fatal — some filesystems/containers don't support chmod semantics
    // (matches GatewayClaimsManager's own identical tolerance for this).
  }
}

/**
 * Byte-identical to netgetMonadProcess.ts's original resolveGatewaySeed()
 * before this module existed. Used ONLY for the requiresMigration case, so
 * an existing installation's monad keeps resolving to the exact seed it
 * always has, unchanged, until an operator explicitly migrates it.
 */
function legacyHostnameDerivedSeed(): string {
  return `netget-gateway:${os.hostname().toLowerCase()}`;
}

/**
 * Resolves this installation's ledger identity — generating and
 * persisting one on a genuinely fresh install, reusing the persisted one
 * on every call after that, and never silently generating a new one over
 * an installation that already has state. Not memoized: the file backing
 * this rarely if ever changes after the first call, and re-reading it is
 * cheap — correctness (always reflecting what's actually on disk) beats
 * the marginal cost of a repeat read for identity-critical code like this.
 *
 * Throws in two distinct data-loss situations, neither of which may ever
 * fall back to the hostname-derived seed or generate a new identity —
 * both would silently switch this ledger to a DIFFERENT identity than
 * the one it actually had, which everything depending on it (namespace,
 * monad SEED, whatever a future owner claim or peer authorization ends up
 * anchored to) expects to keep getting:
 *
 *   - The identity file EXISTS but is unreadable or corrupt.
 *   - The identity file is missing, but the separate initialization
 *     marker (see LEDGER_IDENTITY_MARKER_FILENAME) shows this
 *     installation already had one — so "missing" here means lost, not
 *     "never had one."
 *
 * The legacy hostname fallback below is reserved strictly for
 * installations with NEITHER the identity file NOR the marker — a true
 * pre-this-module install, not data loss.
 *
 * Recovering from either thrown case is deliberately left to a human:
 * restore the missing/corrupt file from a backup. Deleting it and
 * restarting to generate a fresh identity is NOT suggested here — that's
 * a deliberate identity reset, a different operation with its own
 * consequences (anything anchored to the old identity becomes
 * unreachable), not an error-recovery step.
 */
export function resolveLedgerIdentity(): LedgerIdentityResolution {
  const fileState = readIdentityFile();

  if (fileState.status === 'valid') {
    const { identity } = fileState;
    // Self-heal: a valid identity file already proves this installation
    // was initialized — if the marker is missing (e.g. it predates the
    // marker's own introduction, or was itself lost independently), it's
    // safe to (re)write it here, since nothing about the secret changes.
    if (!hasInitializationMarker()) {
      writeInitializationMarker(identity);
    }
    return { seedHex: identity.seedHex, id: identity.id, isNew: false, requiresMigration: false };
  }

  if (fileState.status === 'corrupt') {
    throw new Error(
      `netget's ledger-identity.json (${getLedgerIdentityPath()}) exists but is unreadable or ` +
      'corrupted. This installation already had a persisted ledger identity — starting with the ' +
      'old hostname-derived seed instead would silently switch this gateway to a DIFFERENT ' +
      'identity, not recover the one it had. Refusing to start until this is resolved by hand: ' +
      'restore ledger-identity.json from a backup. Resetting this ledger\'s identity on purpose is ' +
      'a separate, deliberate operation — it can leave existing data unreachable, so it is not ' +
      'suggested here as a recovery step.'
    );
  }

  // fileState.status === 'absent' from here on. A missing identity file
  // is NOT itself proof this is a legacy install — check the durable
  // marker first: if it's there, this installation already had a real
  // persisted identity and the file was simply lost (deleted, moved,
  // wiped), which must halt exactly like the corrupt case above.
  if (hasInitializationMarker()) {
    throw new Error(
      `netget's ledger-identity.json (${getLedgerIdentityPath()}) is missing, but this ` +
      `installation's initialization marker (${getLedgerIdentityMarkerPath()}) shows it already ` +
      'had a persisted ledger identity. This is data loss, not a fresh or legacy install — ' +
      'starting with the hostname-derived seed or generating a new identity would silently switch ' +
      'this gateway to a DIFFERENT identity, not recover the one it had. Refusing to start until ' +
      'this is resolved by hand: restore ledger-identity.json from a backup (leave the marker file ' +
      'in place). Resetting this ledger\'s identity on purpose is a separate, deliberate operation ' +
      'with its own consequences, not suggested here as a recovery step.'
    );
  }

  // Truly no trace of this module's identity file ever existing. Either a
  // genuinely fresh install, or a true legacy one (checked next).
  if (hasExistingInstallationState()) {
    // Never silent: an operator running an installation that predates this
    // module must see that it's still on the old hostname-derived seed,
    // not discover it later as an unexplained mismatch. Printed here
    // (rather than by each caller) so every path that resolves this
    // installation's identity — not just startNetgetMonad() — surfaces it.
    console.warn(
      "[netget] This installation has existing state (an owner claim or a legacy domains.db) " +
      "but no persisted ledger-identity.json. Still using the old hostname-derived seed for " +
      "continuity — nothing was overwritten. Migrating to a persisted, hostname-independent " +
      "identity requires an explicit step; see ledgerIdentity.ts."
    );
    return {
      seedHex: legacyHostnameDerivedSeed(),
      id: '(legacy — migration required)',
      isNew: false,
      requiresMigration: true,
    };
  }

  const identity: LedgerIdentity = {
    id: generatePublicId(),
    seedHex: generateSeedHex(),
    createdAt: Date.now(),
  };
  // Identity file first, marker second: if this process crashes in
  // between, the next resolve sees a VALID identity file (the `valid`
  // branch above) and just self-heals the marker — never regenerates a
  // second, different identity over the one already written.
  writeIdentityFile(identity);
  writeInitializationMarker(identity);
  return { seedHex: identity.seedHex, id: identity.id, isNew: true, requiresMigration: false };
}
