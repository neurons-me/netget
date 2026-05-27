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
 * 2. ensureGatewayIdentity()  →  derive `.me` identity from SEED
 * 3. Display identityHash
 * 4. Confirm prompt
 * 5. mgr.bootstrapOwner(identityHash)  →  write gateway-claims.json
 * 6. Success summary
 * ```
 *
 * The resulting `identityHash` is the deterministic `.me` identity hash.
 * This hash controls all admin access to `local.netget` until ownership is
 * explicitly transferred.
 *
 * @see {@link module:NetGetX.Auth.GatewayClaimsManager}
 * @see {@link module:NetGetX.Auth.GatewayIdentity}
 */

import inquirer from 'inquirer';
import chalk    from 'chalk';
import { GatewayClaimsManager } from './GatewayClaimsManager.ts';
import { ensureGatewayIdentity }  from './GatewayIdentity.ts';

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function printBootstrapBanner(): void {
    console.clear();
    console.log(chalk.bold.cyan(`
  ╔════════════════════════════════════════════════╗
  ║        NetGet — First Run Setup                ║
  ╚════════════════════════════════════════════════╝`));
    console.log(`
  Welcome.  This gateway has ${chalk.bold('no owner yet')}.

  NetGet will derive the gateway owner from your ${chalk.bold('.me seed')}.
  Your ${chalk.bold('identity hash')} becomes the gateway owner — the root claim
  that controls domains, apps, routing, and admin access.

  ${chalk.gray('No gateway keypair is generated. .me remains the proof layer.')}
  ${chalk.gray('Set SEED in the environment before starting NetGet.')}
`);
}

// ---------------------------------------------------------------------------
// runBootstrapWizard
// ---------------------------------------------------------------------------

/**
 * Runs the first-run bootstrap wizard interactively.
 *
 * @returns The `identityHash` written as gateway owner, or `null` if the user
 *          cancelled.  Returns the existing owner hash immediately when the
 *          gateway is already bootstrapped (safe to call defensively).
 */
export async function runBootstrapWizard(): Promise<string | null> {
    const mgr = new GatewayClaimsManager();

    // Already bootstrapped — nothing to do.
    if (!mgr.needsBootstrap()) {
        return mgr.read()!.owner;
    }

    printBootstrapBanner();

    // ── Step 1: identity ──────────────────────────────────────────────────
    console.log(chalk.cyan('  [1/2] Resolving your .me identity…'));
    let identity;
    try {
        identity = ensureGatewayIdentity();
    } catch (err) {
        console.error(chalk.red(`\n  ✖ Could not resolve .me identity: ${(err as Error).message}`));
        return null;
    }

    console.log(chalk.green(`  ✔ .me identity resolved from ${identity.seedEnv}.`));

    console.log(`
  ${chalk.bold('Your identity hash:')}
  ${chalk.yellow.bold('  ' + identity.identityHash)}

  ${chalk.gray('This 64-char hex string is derived by .me from your seed.')}
  ${chalk.gray('Keep the seed safe — .me uses it for proof of ownership.')}
`);

    // ── Step 2: confirm ───────────────────────────────────────────────────
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
            type:    'confirm',
            name:    'confirm',
            message: chalk.bold('Set this identity as gateway owner and start NetGet?'),
            default: true,
        },
    ]);

    if (!confirm) {
        console.log(chalk.yellow('\n  Bootstrap cancelled. Gateway remains unowned.'));
        return null;
    }

    // ── Step 3: write claims ──────────────────────────────────────────────
    console.log(chalk.cyan('\n  [2/2] Writing gateway claims…'));
    try {
        mgr.bootstrapOwner(identity.identityHash);
    } catch (err) {
        console.error(chalk.red(`\n  ✖ Could not write gateway claims: ${(err as Error).message}`));
        return null;
    }

    console.log(chalk.green('  ✔ Gateway owner set.\n'));
    console.log(`  Gateway ID:   ${chalk.bold(mgr.gatewayId)}`);
    console.log(`  Owner hash:   ${chalk.yellow(identity.identityHash)}`);
    console.log(`  Admin scopes: ${chalk.green('all (domains, apps, routes, gateway)')}`);
    console.log(chalk.gray('\n  The admin panel is now active at https://local.netget'));
    console.log('');

    return identity.identityHash;
}
