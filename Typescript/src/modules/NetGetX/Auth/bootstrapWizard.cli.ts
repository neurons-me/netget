/**
 * @module bootstrapWizard
 * @memberof module:NetGetX.Auth
 *
 * First-run CLI wizard that establishes the gateway owner identity.
 *
 * Invoked automatically by `NetGetX.cli.ts` when `netget ON` fires and
 * `GatewayClaimsManager.needsBootstrap()` returns `true`.
 *
 * ## Flow
 *
 * ```text
 * 1. Print first-run banner
 * 2. Prompt: username  (visible)
 * 3. Prompt: secret    (masked with inquirer password)
 * 4. deriveIdentityFromCredentials(username, secret)
 *    → same double-keccak256 path that Cleaker uses in the browser
 * 5. Confirm prompt
 * 6. mgr.bootstrapOwner(identityHash)  →  semantic ledger + gateway-claims.json
 * 7. chmod 600 on gateway-claims.json  →  OS-level access control
 * 8. Success summary
 * ```
 *
 * The resulting `identityHash` is byte-identical to what the browser Cleaker
 * produces for the same credentials — so login in local.netget works immediately
 * after anchor without any additional setup.
 *
 * @see {@link module:NetGetX.Auth.GatewayClaimsManager}
 * @see {@link module:NetGetX.Auth.GatewayIdentity}
 */

import fs       from 'fs';
import os       from 'os';
import inquirer from 'inquirer';
import chalk    from 'chalk';

import { GatewayClaimsManager, getGatewayClaimsPath } from './GatewayClaimsManager.ts';
import { deriveIdentityFromCredentials, deriveGatewayProofKey } from './GatewayIdentity.ts';

// ── Banner ────────────────────────────────────────────────────────────────────

function printBootstrapBanner(hostname: string): void {
    console.clear();
    console.log(chalk.bold.cyan(`
  ╔════════════════════════════════════════════════╗
  ║        NetGet — First Run Setup                ║
  ╚════════════════════════════════════════════════╝`));
    console.log(`
  Welcome.  This gateway has ${chalk.bold('no owner yet')}.

  You are about to anchor a ${chalk.bold('.me human identity')} to this machine.
  The machine session is:  ${chalk.yellow.bold(hostname)}

  Enter the ${chalk.bold('username + secret')} you use with ${chalk.bold('Cleaker / .me')}.
  The same credentials unlock this panel from any browser on this network.

  ${chalk.gray('Nothing is sent over the network. The hash is derived locally.')}
  ${chalk.gray('Your secret is never stored — only the resulting 64-char hash.')}
`);
}

// ── runBootstrapWizard ────────────────────────────────────────────────────────

/**
 * Runs the first-run bootstrap wizard interactively.
 *
 * @returns The `identityHash` written as gateway owner, or `null` if the user
 *          cancelled.  Returns the existing owner hash immediately when the
 *          gateway is already bootstrapped (safe to call defensively).
 */
export async function runBootstrapWizard(): Promise<string | null> {
    const mgr      = new GatewayClaimsManager();
    const hostname = os.hostname();

    // Already bootstrapped — nothing to do.
    if (!mgr.needsBootstrap()) {
        return mgr.read()!.owner;
    }

    printBootstrapBanner(hostname);

    // ── Step 1: credentials ───────────────────────────────────────────────────
    const { who, secret } = await inquirer.prompt<{ who: string; secret: string }>([
        {
            type:     'input',
            name:     'who',
            message:  chalk.bold('Username (.me / Cleaker):'),
            validate: (v: string) => v.trim().length > 0 || 'Username is required.',
        },
        {
            type:     'password',
            name:     'secret',
            message:  chalk.bold('Secret (masked):'),
            mask:     '●',
            validate: (v: string) => v.length > 0 || 'Secret is required.',
        },
    ]);

    // ── Step 2: derive identityHash + Ed25519 proof key ──────────────────────
    console.log(chalk.cyan('\n  [1/2] Deriving .me identity…'));

    // Normalize username the same way Cleaker does in the browser:
    // trim + lowercase so the CLI and browser always hash the same bytes.
    const normalizedWho = who.trim().toLowerCase();

    let identityHash: string;
    let proofPublicKey: string | null = null;
    try {
        // Exact same double-keccak256 path as Cleaker in the browser.
        // Uses normalized (lowercase, trimmed) username to match browser behavior.
        identityHash = deriveIdentityFromCredentials(normalizedWho, secret);
    } catch (err) {
        console.error(chalk.red(`\n  ✖ Could not derive .me identity: ${(err as Error).message}`));
        return null;
    }

    // Derive the Ed25519 proof key via cleaker(me, namespace).
    // The third arg is the hostname (= rootNamespace), matching what the browser
    // Cleaker passes as proof.rootNamespace during challenge-response auth.
    const machineHostname = hostname.toLowerCase().endsWith('.local')
        ? hostname.toLowerCase()
        : `${hostname.toLowerCase()}.local`;
    try {
        proofPublicKey = await deriveGatewayProofKey(normalizedWho, secret, machineHostname);
        console.log(chalk.green(`  ✔ Identity + Ed25519 proof key derived.`));
    } catch {
        // Non-fatal: if WebCrypto is unavailable, fall back to hash-only auth.
        console.log(chalk.green(`  ✔ Identity derived.`));
        console.warn(chalk.yellow('  ⚠ Ed25519 key derivation skipped — WebCrypto not available. Hash-only auth will be used.'));
    }

    console.log(`
  ${chalk.bold('Human identity:')}    ${chalk.yellow.bold(who + '.' + hostname)}
  ${chalk.bold('Identity hash:')}     ${chalk.yellow.bold(identityHash)}
  ${chalk.bold('Ed25519 pubkey:')}    ${chalk.yellow(proofPublicKey ?? '(not derived — hash-only auth)')}

  ${chalk.gray('The browser signs a challenge nonce with the Ed25519 key on each login.')}
  ${chalk.gray('Secret never leaves the browser. Key rotates only if seed phrase changes.')}
`);

    // ── Step 3: confirm ───────────────────────────────────────────────────────
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
            type:    'confirm',
            name:    'confirm',
            message: chalk.bold(`Set "${who}.${hostname}" as gateway owner and start NetGet?`),
            default: true,
        },
    ]);

    if (!confirm) {
        console.log(chalk.yellow('\n  Bootstrap cancelled. Gateway remains unowned.'));
        return null;
    }

    // ── Step 4: write claims ──────────────────────────────────────────────────
    console.log(chalk.cyan('\n  [2/2] Writing gateway claims…'));

    try {
        // GatewayClaimsManager handles:
        //   - atomic write (tmp → rename, nginx never sees partial file)
        //   - SHA-256 version hash (triggers Lua hot-reload)
        //   - companion .version file bump
        // proofPublicKey is stored in claims.pubkeys — enables Ed25519 challenge-response.
        // normalizedWho is stored in claims.usernames — shows human-readable name in admin panel.
        await mgr.bootstrapOwner(identityHash, proofPublicKey, undefined, normalizedWho);
    } catch (err) {
        console.error(chalk.red(`\n  ✖ Could not write gateway claims: ${(err as Error).message}`));
        return null;
    }

    // chmod 600 — only the OS user who ran this command can read/write.
    // This is the physical proof that the OS authorised this anchor.
    try {
        fs.chmodSync(getGatewayClaimsPath(), 0o600);
    } catch {
        // Non-fatal on systems where chmod semantics differ (e.g. some Docker envs).
        console.warn(chalk.yellow('  ⚠ Could not set chmod 600 on gateway-claims.json.'));
    }

    console.log(chalk.green('  ✔ Gateway owner set.\n'));
    console.log(`  Machine session:  ${chalk.bold(hostname)}`);
    console.log(`  Human identity:   ${chalk.bold(who + '.' + hostname)}`);
    console.log(`  Identity hash:    ${chalk.yellow(identityHash)}`);
    console.log(`  Ed25519 pubkey:   ${chalk.yellow(proofPublicKey ?? '(not stored — hash-only auth)')}`);
    console.log(`  Auth mode:        ${chalk.green(proofPublicKey ? 'Ed25519 challenge-response ✓' : 'hash comparison (legacy)')}`);
    console.log(`  Admin scopes:     ${chalk.green('all (domains, apps, routes, gateway)')}`);
    console.log(`  Claims file:      ${chalk.gray(getGatewayClaimsPath())} ${chalk.green('(chmod 600)')}`);
    console.log(chalk.gray('\n  The admin panel is now active at https://local.netget\n'));

    return identityHash;
}
