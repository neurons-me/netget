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

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getLetsEncryptLiveDir(domain: string): string {
    return `/etc/letsencrypt/live/${domain}`;
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
 * Provision a Let's Encrypt cert for `domain` via certbot HTTP-01 webroot.
 *
 * Requirements:
 * - Port 80 must be reachable on the public internet for `domain`.
 * - The nginx port 80 block must serve /.well-known/acme-challenge/ from getAcmeWebroot()
 *   (setNginxConfigFile.ts already includes this location).
 */
export async function provisionCert(domain: string, email: string): Promise<ProvisionResult> {
    if (!isCertbotInstalled()) {
        return { ok: false, message: 'certbot not found. Install with: sudo apt install certbot  OR  brew install certbot' };
    }

    const webroot = getAcmeWebroot();
    fs.mkdirSync(path.join(webroot, '.well-known', 'acme-challenge'), { recursive: true });

    console.log(chalk.blue(`Provisioning Let's Encrypt cert for ${domain}…`));
    console.log(chalk.gray(`  webroot: ${webroot}`));
    console.log(chalk.gray(`  email:   ${email}`));

    const args = [
        'certonly',
        '--webroot',
        '-w', webroot,
        '-d', domain,
        '--non-interactive',
        '--agree-tos',
        '-m', email,
        '--expand',
    ];

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
${netgetBin} ssl sync-certs 2>&1 || true
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
