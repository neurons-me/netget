/**
 * mkcert integration for NetGet local HTTPS.
 *
 * Certs are stored in ~/.netget/certs/ — no sudo needed for cert generation.
 * The only sudo in the entire HTTPS flow is the nginx service itself,
 * which is already handled by installOpenRestyService().
 *
 * ensureMkcertCert() is fully automatic: install mkcert → install CA →
 * generate cert. Zero prompts. Called as part of "NetGet ON".
 *
 * Reference: https://github.com/FiloSottile/mkcert
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Cert paths — user-owned, no sudo needed
// ---------------------------------------------------------------------------

export function getNetgetCertDir(): string {
    return path.join(os.homedir(), '.netget', 'certs');
}

export const MKCERT_CERT_PATH = path.join(os.homedir(), '.netget', 'certs', 'local.netget.pem');
export const MKCERT_KEY_PATH  = path.join(os.homedir(), '.netget', 'certs', 'local.netget-key.pem');

export interface MkcertStatus {
    mkcertInstalled: boolean;
    mkcertBin:       string | null;
    caInstalled:     boolean;
    certExists:      boolean;
    keyExists:       boolean;
    /** true when the cert was signed by the local mkcert CA */
    certIsMkcert:    boolean;
}

export interface EnsureResult {
    ok:      boolean;
    message: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function runSudo(shellCmd: string): boolean {
    const r = spawnSync('sudo', ['sh', '-c', shellCmd], { stdio: 'inherit' });
    return !r.error && r.status === 0;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function findMkcertBin(): string | null {
    for (const c of [
        '/opt/homebrew/bin/mkcert',
        '/usr/local/bin/mkcert',
        '/usr/bin/mkcert',
    ]) {
        if (fs.existsSync(c)) return c;
    }
    const r = spawnSync('which', ['mkcert'], { encoding: 'utf8' });
    return (r.stdout ?? '').trim() || null;
}

export function isMkcertInstalled(): boolean {
    return !!findMkcertBin();
}

function getMkcertCARoot(): string | null {
    const bin = findMkcertBin();
    if (!bin) return null;
    const r = spawnSync(bin, ['-CAROOT'], { encoding: 'utf8' });
    return (r.stdout ?? '').trim() || null;
}

export function isMkcertCAInstalled(): boolean {
    const caRoot = getMkcertCARoot();
    if (!caRoot) return false;
    return fs.existsSync(path.join(caRoot, 'rootCA.pem'));
}

/**
 * Quick sync check — reads cert issuer (no full openssl verify needed).
 * A mkcert-signed cert always has "mkcert" in its issuer.
 */
export function isCertMkcertSigned(): boolean {
    if (!fs.existsSync(MKCERT_CERT_PATH)) return false;
    const r = spawnSync('openssl', [
        'x509', '-in', MKCERT_CERT_PATH, '-noout', '-issuer',
    ], { encoding: 'utf8' });
    if (r.error || r.status !== 0) return false;
    return /mkcert/i.test(r.stdout ?? '');
}

export function getMkcertStatus(): MkcertStatus {
    const mkcertBin = findMkcertBin();
    return {
        mkcertInstalled: !!mkcertBin,
        mkcertBin,
        caInstalled:  isMkcertCAInstalled(),
        certExists:   fs.existsSync(MKCERT_CERT_PATH),
        keyExists:    fs.existsSync(MKCERT_KEY_PATH),
        certIsMkcert: isCertMkcertSigned(),
    };
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * Fix CA key ownership if a previous bad `sudo mkcert -install` run left
 * rootCA-key.pem owned by root. Must be called before any mkcert command.
 */
export function fixCAKeyPermissions(): void {
    const caRoot = getMkcertCARoot();
    if (!caRoot) return;
    const keyFile = path.join(caRoot, 'rootCA-key.pem');
    if (!fs.existsSync(keyFile)) return;
    try {
        // Try reading the key as the current user — if it fails, it's a root-owned file.
        fs.accessSync(keyFile, fs.constants.R_OK);
    } catch {
        const username = (process.env.SUDO_USER || process.env.USER || '').trim();
        if (!username) return;
        runSudo(`chown -R "${username}" "${caRoot}" 2>/dev/null || true`);
    }
}

// ---------------------------------------------------------------------------
// Individual steps (used by the guided CLI menu)
// ---------------------------------------------------------------------------

/** Install mkcert via Homebrew — no sudo needed. */
export function installMkcertViaBrew(): boolean {
    const r = spawnSync('brew', ['install', 'mkcert'], { stdio: 'inherit' });
    return !r.error && r.status === 0;
}

/** Register the local CA with the OS/browser trust stores — no sudo needed on macOS. */
export function installMkcertCA(): boolean {
    const bin = findMkcertBin();
    if (!bin) throw new Error('mkcert not found. Install with: brew install mkcert');
    const r = spawnSync(bin, ['-install'], { stdio: 'inherit' });
    return !r.error && r.status === 0;
}

/**
 * Generate a cert for local.netget / localhost / 127.0.0.1.
 * Written directly to ~/.netget/certs/ — no sudo needed.
 */
export function generateMkcertCert(): boolean {
    const bin = findMkcertBin();
    if (!bin) throw new Error('mkcert not found. Install with: brew install mkcert');

    fixCAKeyPermissions();

    const certDir = getNetgetCertDir();
    fs.mkdirSync(certDir, { recursive: true });

    // Include the machine's .local mDNS hostname so LAN devices can reach it too.
    const hostname     = os.hostname();
    const localDomain  = hostname.endsWith('.local') ? hostname : `${hostname}.local`;
    const extraHosts   = localDomain !== 'localhost.local' ? [localDomain] : [];

    const r = spawnSync(bin, [
        '-cert-file', MKCERT_CERT_PATH,
        '-key-file',  MKCERT_KEY_PATH,
        'local.netget', 'localhost', '127.0.0.1', ...extraHosts,
    ], { stdio: 'inherit' });

    return !r.error && r.status === 0;
}

// ---------------------------------------------------------------------------
// Bootstrap — fully automatic, no prompts
// ---------------------------------------------------------------------------

/**
 * Ensure a trusted mkcert cert exists for local.netget.
 * Called automatically when the NetGet gateway turns ON.
 * No user prompts. No sudo for the cert itself.
 *
 * Steps:
 *   1. Install mkcert via Homebrew if missing
 *   2. Fix CA key permissions if damaged by a previous sudo run
 *   3. Install local CA into OS trust store if not already there
 *   4. Generate cert into ~/.netget/certs/ if not already mkcert-signed
 */
export function ensureMkcertCert(): EnsureResult {
    // 1 — mkcert binary
    if (!isMkcertInstalled()) {
        const ok = installMkcertViaBrew();
        if (!ok) return { ok: false, message: 'mkcert install via brew failed' };
    }

    // 2 — permissions
    fixCAKeyPermissions();

    // 3 — CA in trust store
    if (!isMkcertCAInstalled()) {
        const ok = installMkcertCA();
        if (!ok) return { ok: false, message: 'mkcert CA install failed' };
    }

    // 4 — cert
    if (!isCertMkcertSigned()) {
        const ok = generateMkcertCert();
        if (!ok) return { ok: false, message: 'cert generation failed' };
    }

    return { ok: true, message: 'HTTPS ready' };
}
