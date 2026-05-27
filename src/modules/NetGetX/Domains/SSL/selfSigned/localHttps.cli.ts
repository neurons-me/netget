import chalk from 'chalk';
import inquirer from 'inquirer';
import includeNetgetAppConf from '../../../OpenResty/includeNetgetAppConf.ts';
import { startOpenRestyOnce } from '../../../OpenResty/openRestyService.ts';
import {
    generateSelfSignedCert,
    getSelfSignedCertificateStatus,
    renewSelfSignedCert,
} from '../selfSignedCertificates.ts';
import {
    findMkcertBin,
    getMkcertStatus,
    installMkcertViaBrew,
    installMkcertCA,
    generateMkcertCert,
    fixCAKeyPermissions,
    type MkcertStatus,
} from '../mkcert/mkcert.ts';

type LocalHttpsChoice =
    | 'status'
    | 'setup-mkcert'
    | 'generate'
    | 'renew'
    | 'refresh-conf'
    | 'reload'
    | 'back';

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

async function printLocalHttpsStatus(mkcert: MkcertStatus): Promise<void> {
    const cert = await getSelfSignedCertificateStatus();

    console.log(chalk.cyan('\nLocal HTTPS / Certificates'));

    // ── mkcert status ──
    console.log('');
    console.log(chalk.bold('  Trusted local CA (mkcert)'));
    console.log(`    mkcert installed : ${mkcert.mkcertInstalled ? chalk.green('yes') : chalk.yellow('no — brew install mkcert')}`);
    if (mkcert.mkcertInstalled) {
        console.log(`    CA in trust store: ${mkcert.caInstalled  ? chalk.green('yes') : chalk.yellow('no — run setup')}`);
        console.log(`    cert is mkcert   : ${mkcert.certIsMkcert ? chalk.green('yes') : chalk.gray('no')}`);
    }

    // ── cert files ──
    console.log('');
    console.log(chalk.bold('  Cert files'));
    console.log(`    cert : ${cert.certExists ? chalk.green(cert.certPath)     : chalk.yellow(`${cert.certPath} (missing)`)}`);
    console.log(`    key  : ${cert.keyExists  ? chalk.green(cert.keyPath)      : chalk.yellow(`${cert.keyPath} (missing)`)}`);
    console.log(`    valid: ${cert.valid      ? chalk.green('yes')             : chalk.yellow('no')}`);
    if (cert.subject)   console.log(`    subject : ${chalk.gray(cert.subject)}`);
    if (cert.notAfter)  console.log(`    expires : ${chalk.gray(cert.notAfter)}`);
    if (cert.san)       console.log(`    SAN     : ${chalk.gray(cert.san)}`);
    if (!cert.san || !cert.san.includes('local.netget')) {
        console.log(`    browser SAN: ${chalk.yellow('missing local.netget — renew recommended')}`);
    }
    if (cert.error) console.log(`    error: ${chalk.yellow(cert.error)}`);

    console.log('');
    if (mkcert.certIsMkcert) {
        console.log(chalk.green('  ✓ https://local.netget is trusted by browsers on this machine.'));
    } else if (cert.certExists) {
        console.log(chalk.yellow('  ⚠  Self-signed cert present. Browsers will show a warning for https://local.netget.'));
        console.log(chalk.gray('     Use "Setup trusted HTTPS (mkcert)" to fix this.'));
    } else {
        console.log(chalk.yellow('  ⚠  No cert found. NetGet serves HTTP only on port 80.'));
        console.log(chalk.gray('     Use "Setup trusted HTTPS (mkcert)" to enable HTTPS.'));
    }
    console.log('');
}

// ---------------------------------------------------------------------------
// Guided mkcert setup flow
// ---------------------------------------------------------------------------

async function setupMkcert(): Promise<void> {
    console.clear();
    console.log(chalk.bold('📍 Setup trusted HTTPS (mkcert)\n'));
    console.log(chalk.gray('mkcert creates a local Certificate Authority and installs it in the OS/browser trust'));
    console.log(chalk.gray('stores so that https://local.netget opens without any browser warning.\n'));

    // Step 1 — ensure mkcert is installed
    let bin = findMkcertBin();
    if (!bin) {
        console.log(chalk.yellow('Step 1/3: mkcert not found.'));
        const { install } = await inquirer.prompt<{ install: boolean }>([{
            type: 'confirm',
            name: 'install',
            message: 'Install mkcert via Homebrew now? (brew install mkcert)',
            default: true,
        }]);
        if (!install) {
            console.log(chalk.gray('\nAborted. To install manually: brew install mkcert'));
            await pause('Press Enter to go back.');
            return;
        }
        console.log(chalk.cyan('\nRunning: brew install mkcert'));
        if (!installMkcertViaBrew()) {
            console.log(chalk.red('\nHomebrew install failed. Please install mkcert manually and retry.'));
            await pause('Press Enter to go back.');
            return;
        }
        bin = findMkcertBin();
        if (!bin) {
            console.log(chalk.red('\nmkcert still not found after install. Try reopening your terminal and retrying.'));
            await pause('Press Enter to go back.');
            return;
        }
        console.log(chalk.green('mkcert installed.\n'));
    } else {
        console.log(chalk.green(`Step 1/3: mkcert found at ${bin}`));
    }

    // Repair CA key permissions if a previous sudo run left them owned by root.
    // This must happen before mkcert -install and before cert generation.
    console.log(chalk.gray('\nChecking CA key permissions...'));
    fixCAKeyPermissions();

    // Step 2 — install CA into system trust store (no sudo needed on macOS)
    console.log('');
    console.log(chalk.bold('Step 2/3: Install local CA into system trust store'));
    console.log(chalk.gray('Registers the mkcert CA with macOS Keychain → trusted by Safari, Chrome, Firefox.\n'));
    const { doCA } = await inquirer.prompt<{ doCA: boolean }>([{
        type: 'confirm',
        name: 'doCA',
        message: 'Run "mkcert -install" now? (one-time)',
        default: true,
    }]);
    if (!doCA) {
        console.log(chalk.yellow('\nSkipped CA install. Certs will be generated but browsers may still warn.'));
    } else {
        console.log(chalk.cyan('\nRunning: mkcert -install'));
        if (!installMkcertCA()) {
            console.log(chalk.red('\nCA installation failed. Check output above.'));
            await pause('Press Enter to go back.');
            return;
        }
        console.log(chalk.green('\nLocal CA installed and trusted by browsers on this machine.'));
    }

    // Step 3 — generate cert for local.netget
    console.log('');
    console.log(chalk.bold('Step 3/3: Generate certificate for local.netget'));
    console.log(chalk.gray('Generates a cert for local.netget + localhost + 127.0.0.1 and places it where'));
    console.log(chalk.gray('NetGet/nginx expects it. Requires sudo to write to /etc/ssl.\n'));
    const { doCert } = await inquirer.prompt<{ doCert: boolean }>([{
        type: 'confirm',
        name: 'doCert',
        message: 'Generate cert for local.netget now? (requires sudo)',
        default: true,
    }]);
    if (!doCert) {
        console.log(chalk.yellow('\nSkipped cert generation.'));
        await pause('Press Enter to go back.');
        return;
    }
    console.log(chalk.cyan('\nGenerating cert for local.netget, localhost, 127.0.0.1...'));
    if (!generateMkcertCert()) {
        console.log(chalk.red('\nCert generation failed. Check sudo output above.'));
        await pause('Press Enter to go back.');
        return;
    }
    console.log(chalk.green('\nCert generated and placed in /etc/ssl.'));

    // Refresh config + reload gateway
    console.log(chalk.cyan('\nRefreshing NetGet gateway config...'));
    await includeNetgetAppConf();
    if (await startOpenRestyOnce(true)) {
        console.log(chalk.green('NetGet gateway reloaded with HTTPS enabled.'));
    } else {
        console.log(chalk.yellow('Gateway reload did not finish cleanly — try "Reload NetGet gateway" manually.'));
    }

    console.log('');
    console.log(chalk.green('✓ Done. Open https://local.netget — no browser warning.'));
    await pause('Press Enter to return.');
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

async function pause(message = 'Press Enter to return.'): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: '_', message }]);
}

export default async function localHttpsMenu(): Promise<void> {
    while (true) {
        console.clear();
        const mkcert = getMkcertStatus();
        await printLocalHttpsStatus(mkcert);

        const { choice } = await inquirer.prompt<{ choice: LocalHttpsChoice }>([{
            type: 'list',
            name: 'choice',
            message: 'Local HTTPS — choose an action:',
            choices: [
                {
                    name: mkcert.certIsMkcert
                        ? chalk.green('✓ Trusted HTTPS (mkcert) — regenerate cert')
                        : chalk.cyan('Setup trusted HTTPS (mkcert) — recommended'),
                    value: 'setup-mkcert',
                },
                new inquirer.Separator('─── Self-signed fallback (browser will warn) ───'),
                { name: 'Generate self-signed certificate if missing', value: 'generate' },
                { name: 'Renew / regenerate self-signed certificate',  value: 'renew'    },
                new inquirer.Separator(),
                { name: 'Refresh NetGet gateway config', value: 'refresh-conf' },
                { name: 'Reload NetGet gateway',         value: 'reload'       },
                new inquirer.Separator(),
                { name: 'Back', value: 'back' },
            ],
        }]);

        if (choice === 'back') return;

        if (choice === 'setup-mkcert') {
            await setupMkcert();
            continue;
        }

        if (choice === 'generate') {
            await generateSelfSignedCert();
            continue;
        }

        if (choice === 'renew') {
            const { confirmRenew } = await inquirer.prompt<{ confirmRenew: boolean }>([{
                type: 'confirm',
                name: 'confirmRenew',
                message: 'Regenerate the self-signed certificate now?',
                default: false,
            }]);
            if (confirmRenew) await renewSelfSignedCert();
            continue;
        }

        if (choice === 'refresh-conf') {
            await includeNetgetAppConf();
            console.log(chalk.green('NetGet gateway config refreshed.'));
            await pause();
            continue;
        }

        if (choice === 'reload') {
            if (await startOpenRestyOnce(true)) console.log(chalk.green('NetGet gateway reloaded.'));
            else console.log(chalk.yellow('Reload did not finish successfully.'));
            await pause();
        }
    }
}
