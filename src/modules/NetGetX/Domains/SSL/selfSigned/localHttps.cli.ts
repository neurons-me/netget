import chalk from 'chalk';
import inquirer from 'inquirer';
import includeNetgetAppConf from '../../../OpenResty/includeNetgetAppConf.ts';
import { startOpenRestyOnce } from '../../../OpenResty/openRestyService.ts';
import {
    generateSelfSignedCert,
    getSelfSignedCertificateStatus,
    renewSelfSignedCert,
} from '../selfSignedCertificates.ts';

type LocalHttpsChoice = 'status' | 'generate' | 'renew' | 'refresh-conf' | 'reload' | 'back';

async function printLocalHttpsStatus(): Promise<void> {
    const status = await getSelfSignedCertificateStatus();
    console.log(chalk.cyan('\nLocal HTTPS / self-signed certificate'));
    console.log(`  cert: ${status.certExists ? chalk.green(status.certPath) : chalk.yellow(`${status.certPath} (missing)`)}`);
    console.log(`  key:  ${status.keyExists ? chalk.green(status.keyPath) : chalk.yellow(`${status.keyPath} (missing)`)}`);
    console.log(`  valid: ${status.valid ? chalk.green('yes') : chalk.yellow('no')}`);
    if (status.subject) console.log(`  subject: ${chalk.gray(status.subject)}`);
    if (status.notBefore) console.log(`  from: ${chalk.gray(status.notBefore)}`);
    if (status.notAfter) console.log(`  until: ${chalk.gray(status.notAfter)}`);
    if (status.san) console.log(`  SAN: ${chalk.gray(status.san)}`);
    if (!status.san || !status.san.includes('local.netget')) {
        console.log(`  browser SAN: ${chalk.yellow('missing local.netget - renew recommended')}`);
    }
    if (status.error) console.log(`  error: ${chalk.yellow(status.error)}`);
    console.log(`  URLs: ${chalk.green('https://local.netget')} ${chalk.gray('and')} ${chalk.green('https://localhost')}`);
    console.log('');
}

export default async function localHttpsMenu(): Promise<void> {
    while (true) {
        await printLocalHttpsStatus();

        const { choice } = await inquirer.prompt<{ choice: LocalHttpsChoice }>([{
            type: 'list',
            name: 'choice',
            message: 'Local HTTPS - choose an action:',
            choices: [
                { name: 'Status', value: 'status' },
                new inquirer.Separator(),
                { name: 'Generate certificate if missing', value: 'generate' },
                { name: 'Renew/regenerate certificate for local.netget + localhost', value: 'renew' },
                new inquirer.Separator(),
                { name: 'Refresh OpenResty app config', value: 'refresh-conf' },
                { name: 'Reload OpenResty once', value: 'reload' },
                new inquirer.Separator(),
                { name: 'Back', value: 'back' },
            ],
        }]);

        if (choice === 'back') return;
        if (choice === 'status') continue;

        if (choice === 'generate') {
            await generateSelfSignedCert();
            continue;
        }

        if (choice === 'renew') {
            const { confirmRenew } = await inquirer.prompt<{ confirmRenew: boolean }>([{
                type: 'confirm',
                name: 'confirmRenew',
                message: 'Regenerate the local self-signed certificate now?',
                default: false,
            }]);
            if (confirmRenew) await renewSelfSignedCert();
            continue;
        }

        if (choice === 'refresh-conf') {
            await includeNetgetAppConf();
            continue;
        }

        if (choice === 'reload') {
            if (await startOpenRestyOnce(true)) console.log(chalk.green('OpenResty reloaded.'));
            else console.log(chalk.yellow('OpenResty reload did not finish successfully.'));
        }
    }
}
