/**
 * @module bootstrapWizard
 * @memberof module:NetGetX.Auth
 *
 * First-run CLI entry point for establishing the gateway owner — but no
 * longer a signer. Signing keys live only in the browser's own encrypted
 * keychain vault (packages/GUI/Typescript's localKeychainKeyVault.ts) — a
 * CLI/Node process has no access to that storage, and deliberately does
 * not invent a parallel one (there is no "CLI keychain"). So this file's
 * only job now is: is the gateway already owned (nothing to do), and if
 * not, does a setup session/code already exist to hand the person so they
 * can finish the actual claim in a browser, where the real keychain is.
 *
 * `netget init` already prints the code + resolved address itself before
 * ever calling here (see netget.cli.ts's own `resolveSetupAddress`) — so
 * this only creates+prints one itself for the standalone `netget claim`
 * case, where nothing has been printed yet.
 *
 * @see {@link module:NetGetX.Auth.GatewayClaimsManager}
 * @see {@link module:NetGetX.Auth.gatewaySetupSession}
 */

import chalk from 'chalk';

import { GatewayClaimsManager } from './GatewayClaimsManager.ts';
import { createSetupSession } from './gatewaySetupSession.ts';
import { resolveLedgerIdentity } from '../../../kernel/ledgerIdentity.ts';

export interface RunBootstrapWizardOptions {
    /** A setup code `netget init` (just before calling here) already
     *  generated and printed — when given, this does not create or print
     *  a second one. */
    setupCode?: string;
}

/**
 * Ensures a setup session/code exists and points the operator at the
 * browser to actually finish claiming — never signs anything itself.
 *
 * @returns The current owner's `identityHash` when the gateway is already
 *          bootstrapped (safe to call defensively); `null` otherwise —
 *          there is nothing this call itself could have claimed.
 */
export async function runBootstrapWizard(options: RunBootstrapWizardOptions = {}): Promise<string | null> {
    const mgr = new GatewayClaimsManager();

    if (!mgr.needsBootstrap()) {
        return mgr.read()!.owner;
    }

    if (!options.setupCode) {
        const gatewayId = resolveLedgerIdentity().id;
        const session = createSetupSession(gatewayId);
        console.log(chalk.bold('\nSetup code:') + '  ' + chalk.yellow.bold(session.code));
    }

    console.log(chalk.yellow('\n  This terminal can\'t sign the claim — keys live only in your browser\'s keychain.'));
    console.log(chalk.gray('  Open this gateway\'s setup page in a browser and finish there.\n'));
    return null;
}
