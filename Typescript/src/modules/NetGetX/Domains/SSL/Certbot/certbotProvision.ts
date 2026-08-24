/**
 * certbotProvision.ts
 *
 * Automated Let's Encrypt certificate provisioning for public domains.
 *
 * Flow:
 *   1. Verify certbot is installed.
 *   2. Run `certbot certonly --webroot` using xConfig/html as the webroot
 *      (nginx port 80 already serves /.well-known/acme-challenge/ from there).
 *   3. Write cert/key paths into the domain store (triggers domain-map regen).
 *   4. Install a certbot deploy hook so certs are hot-swapped on renewal.
 *
 * No nginx reload is needed after provisioning — the Lua ssl_certificate_by_lua_block
 * reads cert files on every TLS handshake from the domain-map, which is hot-reloaded
 * by the Lua timer every second.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getNetgetDataDir } from '../../../../../utils/netgetPaths.js';
import { updateSSLCertificatePaths, getDomainByName } from '../../../../../kernel/domainStore.js';
import { generateDomainMap, reloadNginx } from '../../../../../runtime/domainMap.js';
import { detectOpenRestyLayout, getWorkerUsername } from '../../../OpenResty/platformDetect.ts';

// ── Paths ─────────────────────────────────────────────────────────────────────

// Overridable for tests; matches the env var setNginxConfigRoutes.ts already
// reads for the same purpose.
function getLetsEncryptLiveRoot(): string {
    return process.env.NETGET_LETSENCRYPT_LIVE_DIR || '/etc/letsencrypt/live';
}

function getLetsEncryptArchiveRoot(): string {
    return process.env.NETGET_LETSENCRYPT_ARCHIVE_DIR || '/etc/letsencrypt/archive';
}

export function getLetsEncryptLiveDir(domain: string): string {
    return path.join(getLetsEncryptLiveRoot(), domain);
}

export function getLetsEncryptArchiveDir(domain: string): string {
    return path.join(getLetsEncryptArchiveRoot(), domain);
}

export function getLetsEncryptCertPath(domain: string): string {
    return path.join(getLetsEncryptLiveDir(domain), 'fullchain.pem');
}

export function getLetsEncryptKeyPath(domain: string): string {
    return path.join(getLetsEncryptLiveDir(domain), 'privkey.pem');
}

/** The webroot nginx already serves on port 80 for ACME HTTP-01 challenges. */
export function getAcmeWebroot(): string {
    return path.join(getNetgetDataDir(), 'html');
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface ProvisionResult {
    ok: boolean;
    message: string;
    certPath?: string;
    keyPath?: string;
}

// ── Core functions ────────────────────────────────────────────────────────────

function isCertbotInstalled(): boolean {
    const r = spawnSync('which', ['certbot'], { encoding: 'utf8' });
    return !r.error && !!(r.stdout ?? '').trim();
}

/** Check if a valid (non-expired) cert already exists for the domain. */
export function certExists(domain: string): boolean {
    const certPath = getLetsEncryptCertPath(domain);
    if (!fs.existsSync(certPath)) return false;
    const r = spawnSync('openssl', ['x509', '-in', certPath, '-noout', '-checkend', '86400'], {
        encoding: 'utf8',
    });
    return !r.error && r.status === 0;
}

/**
 * Grants the OpenResty gateway worker (e.g. www-data) read access to a
 * domain's Let's Encrypt cert files. Certbot writes them root:root mode 600
 * by default, which the non-root gateway worker cannot read — the Lua
 * ssl_certificate_by_lua_block then silently falls back to the default
 * (mkcert) cert with no visible error. Uses a POSIX default ACL on the
 * archive dir so every future renewal (which writes new numbered files
 * there) inherits read access automatically. Best-effort: never throws.
 */
export function ensureCertReadableByGatewayWorker(
    domain: string,
    opts: { platform?: NodeJS.Platform; workerUser?: string | null } = {},
): ProvisionResult {
    const platform = opts.platform ?? process.platform;
    if (platform !== 'linux') {
        return { ok: true, message: 'Not Linux — gateway worker ACL fix skipped.' };
    }

    const user = opts.workerUser !== undefined ? opts.workerUser : getWorkerUsername(detectOpenRestyLayout());
    if (!user) {
        return { ok: false, message: 'Could not determine the gateway worker user — skipped ACL fix.' };
    }

    const liveDir = getLetsEncryptLiveDir(domain);
    const archiveDir = getLetsEncryptArchiveDir(domain);
    const acl = `u:${user}:rX`;

    const grant = spawnSync('sudo', ['setfacl', '-R', '-m', acl, liveDir, archiveDir], { encoding: 'utf8' });
    if (grant.error || grant.status !== 0) {
        return {
            ok: false,
            message: `setfacl failed for ${domain} (is the 'acl' package installed?): ${grant.stderr || grant.error?.message || 'unknown error'}`,
        };
    }

    // Default ACL on the archive dir: future renewals write new numbered
    // files there (privkey7.pem, etc.) that must inherit the same access.
    const inherit = spawnSync('sudo', ['setfacl', '-d', '-m', acl, archiveDir], { encoding: 'utf8' });
    if (inherit.error || inherit.status !== 0) {
        return {
            ok: false,
            message: `setfacl (default ACL) failed for ${domain}: ${inherit.stderr || inherit.error?.message || 'unknown error'}`,
        };
    }

    return { ok: true, message: `Gateway worker (${user}) granted read access to ${domain} certs.` };
}

/** DNS-01 providers with an automated certbot plugin wired up. Only 'google'
 * is implemented today — it covers the majority of wildcard domains this
 * gateway serves (Google Cloud DNS, via the VM's own service account, no
 * credentials file to manage). Add providers here as real hosts show up. */
export type DnsProvider = 'google';

export interface ProvisionOptions {
    /** Also request `*.<domain>` alongside `<domain>` itself. Requires a
     * DNS-01 challenge (HTTP-01/webroot cannot validate wildcards) — must be
     * paired with `dnsProvider`. */
    wildcard?: boolean;
    /** Which certbot DNS plugin to use for the DNS-01 challenge. Required
     * when `wildcard` is true; ignored otherwise (non-wildcard always uses
     * webroot/HTTP-01, unchanged from before this option existed). */
    dnsProvider?: DnsProvider;
}

/**
 * Provision a Let's Encrypt cert for `domain`.
 *
 * Default (no options): HTTP-01 via webroot — single domain, no wildcard.
 * Requirements:
 * - Port 80 must be reachable on the public internet for `domain`.
 * - The nginx port 80 block must serve /.well-known/acme-challenge/ from getAcmeWebroot()
 *   (setNginxConfigFile.ts already includes this location).
 *
 * `{ wildcard: true, dnsProvider: 'google' }`: DNS-01 via certbot-dns-google.
 * Requests `<domain>` and `*.<domain>` in one certificate. No webroot
 * involved — the plugin creates/removes the `_acme-challenge` TXT record
 * itself via the Cloud DNS API, using the VM's own service account
 * (Application Default Credentials) when `roles/dns.admin` is granted on
 * the hosted zone. This is what makes wildcard renewal unattended: unlike
 * `certbot certonly --manual --preferred-challenges dns` (the old wizard in
 * letsEncrypt.ts / SSLCertificates.ts), which needs a human to paste a TXT
 * record every ~90 days, this authenticator is written into the renewal
 * config and `certbot renew` can satisfy it on its own from then on.
 */
export async function provisionCert(
    domain: string,
    email: string,
    options: ProvisionOptions = {},
): Promise<ProvisionResult> {
    if (!isCertbotInstalled()) {
        return { ok: false, message: 'certbot not found. Install with: sudo apt install certbot  OR  brew install certbot' };
    }
    if (options.wildcard && !options.dnsProvider) {
        return { ok: false, message: 'wildcard provisioning requires a dnsProvider (HTTP-01/webroot cannot validate wildcards).' };
    }

    console.log(chalk.blue(`Provisioning Let's Encrypt cert for ${domain}…`));
    console.log(chalk.gray(`  email:   ${email}`));

    const args = ['certonly'];

    if (options.wildcard) {
        if (options.dnsProvider === 'google') {
            args.push('--dns-google');
        }
        console.log(chalk.gray(`  challenge: dns-01 (${options.dnsProvider})`));
        console.log(chalk.gray(`  domains: ${domain}, *.${domain}`));
        args.push('-d', domain, '-d', `*.${domain}`);
    } else {
        const webroot = getAcmeWebroot();
        fs.mkdirSync(path.join(webroot, '.well-known', 'acme-challenge'), { recursive: true });
        console.log(chalk.gray(`  webroot: ${webroot}`));
        args.push('--webroot', '-w', webroot, '-d', domain);
    }

    args.push('--non-interactive', '--agree-tos', '-m', email, '--expand');

    const r = spawnSync('sudo', ['certbot', ...args], { stdio: 'inherit' });
    if (r.error || r.status !== 0) {
        return {
            ok: false,
            message: `certbot failed (exit ${r.status}). Check that port 80 is open and DNS for ${domain} points to this server.`,
        };
    }

    const certPath = getLetsEncryptCertPath(domain);
    const keyPath  = getLetsEncryptKeyPath(domain);

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        return { ok: false, message: `certbot succeeded but cert files not found at ${getLetsEncryptLiveDir(domain)}` };
    }

    // Persist paths into the domain store → triggers domain-map hot-reload.
    await updateSSLCertificatePaths(domain, certPath, keyPath);
    console.log(chalk.green(`✓ Cert provisioned and domain-map updated for ${domain}`));

    const aclResult = ensureCertReadableByGatewayWorker(domain);
    if (aclResult.ok) {
        console.log(chalk.green(`✓ ${aclResult.message}`));
    } else {
        console.log(chalk.yellow(`⚠ ${aclResult.message}`));
        console.log(chalk.gray(`  The gateway worker may not be able to read this cert until fixed manually.`));
    }

    // Install deploy hook for auto-renewal.
    await installRenewalHook(domain);

    return { ok: true, message: 'Certificate provisioned successfully.', certPath, keyPath };
}

/**
 * Re-link cert paths in the domain store after a certbot renewal.
 * Called by the deploy hook and also available as a standalone "sync" command.
 */
export async function syncCertsFromLetsEncrypt(): Promise<void> {
    const { getDomains } = await import('../../../../../kernel/domainStore.js');
    const domains = await getDomains();
    let synced = 0;

    for (const rec of domains) {
        if (!rec.domain) continue;
        const certPath = getLetsEncryptCertPath(rec.domain);
        const keyPath  = getLetsEncryptKeyPath(rec.domain);
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            if (rec.sslCertificate !== certPath || rec.sslCertificateKey !== keyPath) {
                await updateSSLCertificatePaths(rec.domain, certPath, keyPath);
                console.log(chalk.green(`  synced: ${rec.domain}`));
                synced++;
            }
            // Idempotent safety net: re-applies even if the original grant
            // (or its default ACL) never landed, e.g. an older cert issued
            // before this fix existed.
            const aclResult = ensureCertReadableByGatewayWorker(rec.domain);
            if (!aclResult.ok) {
                console.log(chalk.yellow(`  ⚠ ${rec.domain}: ${aclResult.message}`));
            }
        }
    }

    if (synced > 0) {
        await generateDomainMap();
        reloadNginx();
        console.log(chalk.green(`Synced ${synced} domain(s) and reloaded nginx.`));
    } else {
        console.log(chalk.gray('All domain cert paths already up to date.'));
    }
}

// ── Certbot renewal deploy hook ───────────────────────────────────────────────

const HOOK_DIR  = '/etc/letsencrypt/renewal-hooks/deploy';
const HOOK_NAME = 'netget-sync.sh';

async function installRenewalHook(domain: string): Promise<void> {
    if (!fs.existsSync(HOOK_DIR)) return; // certbot not managing this system's renewal

    const hookPath  = path.join(HOOK_DIR, HOOK_NAME);
    const netgetBin = getNetgetBin();

    const script = `#!/bin/bash
# Auto-generated by netget certbotProvision — do not edit manually.
# Runs after every successful certbot renewal to update the netget domain-map
# and gracefully reload OpenResty so the new cert is picked up immediately.
set -e
${netgetBin} sync-certs 2>&1 || true
openresty -s reload 2>/dev/null || nginx -s reload 2>/dev/null || true
`;

    if (!fs.existsSync(hookPath) || fs.readFileSync(hookPath, 'utf8') !== script) {
        try {
            const r = spawnSync('sudo', ['sh', '-c', `tee '${hookPath}' > /dev/null && chmod 755 '${hookPath}'`], {
                input: script,
                encoding: 'utf8',
            });
            if (!r.error && r.status === 0) {
                console.log(chalk.green(`✓ Renewal deploy hook installed at ${hookPath}`));
            }
        } catch {
            console.log(chalk.yellow(`Could not install renewal hook at ${hookPath} — run manually:`));
            console.log(chalk.gray(`  sudo tee ${hookPath} <<'EOF'\n${script}EOF\n  sudo chmod 755 ${hookPath}`));
        }
    }
}

function getNetgetBin(): string {
    // Try resolving the netget CLI from PATH; fall back to npx.
    const r = spawnSync('which', ['netget'], { encoding: 'utf8' });
    const found = (r.stdout ?? '').trim();
    return found || 'npx netget';
}
