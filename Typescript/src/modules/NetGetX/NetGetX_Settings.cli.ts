import inquirer from 'inquirer';
import chalk from 'chalk';
import type { XStateData } from './xState.ts';
import mainServerMenu from './mainServer/mainServer.cli.ts';
import displayStateAndConfig from './config/x_StateAndConfig.ts';
import openRestyInstallationOptions from './OpenResty/openRestyInstallationOptions.cli.ts';

type SettingsAction = 'main-server-name' | 'local-https' | 'gateway-engine' | 'diagnostics' | 'about' | 'back';

function printSettingsHeader(x: XStateData, message?: string): void {
    console.log(chalk.bold('📍 .Local Main Server > Settings'));
    const name = String(x.mainServerName || '').trim();
    console.log(`Public domain/local label: ${name ? chalk.green(name) : chalk.yellow('not set')}`);
    console.log(chalk.gray('Local/NAT: optional label. Public server: real domain that points to this machine.'));
    if (message) console.log(`\n${message}`);
    console.log('');
}

async function pause(message = 'Press Enter to return to Settings.'): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: 'continue', message }]);
}

/**
 * Displays the Main Server settings menu.
 * @memberof module:NetGetX
 */
const netGetXSettingsMenu = async (x: XStateData): Promise<void> => {
    let lastMessage = '';

    while (true) {
        console.clear();
        printSettingsHeader(x, lastMessage);
        lastMessage = '';

        const { action } = await inquirer.prompt<{ action: SettingsAction }>([
            {
                type: 'list',
                name: 'action',
                message: 'Settings - choose an action:',
                choices: [
                    { name: 'Public domain / local label', value: 'main-server-name' },
                    { name: 'Local HTTPS / certificates',  value: 'local-https'      },
                    new inquirer.Separator(),
                    { name: 'Gateway engine advanced', value: 'gateway-engine' },
                    { name: 'Developer diagnostics: xConfig vs xState', value: 'diagnostics' },
                    { name: 'About Main Server', value: 'about' },
                    new inquirer.Separator(),
                    { name: 'Back to Main Server', value: 'back' },
                ],
            },
        ]);

        if (action === 'back') return;
        if (action === 'main-server-name') {
            await mainServerMenu(x);
            continue;
        }

        if (action === 'local-https') {
            const { default: localHttpsMenu } = await import('./Domains/SSL/selfSigned/localHttps.cli.ts');
            await localHttpsMenu();
            continue;
        }

        if (action === 'gateway-engine') {
            await openRestyInstallationOptions();
            continue;
        }

        if (action === 'diagnostics') {
            console.clear();
            console.log(chalk.bold('📍 .Local Main Server > Settings > Diagnostics'));
            console.log(chalk.gray('xConfig is the persisted file on disk. xState is the in-memory copy used by this CLI session.\n'));
            await displayStateAndConfig(x);
            await pause();
            continue;
        }

        if (action === 'about') {
            console.clear();
            console.log(chalk.bold('📍 .Local Main Server > Settings > About'));
            console.log(chalk.cyan('\nMain Server is the local NetGet control plane: gateway, domains, certificates, and UI target.'));
            console.log(chalk.gray('Use NetGet ON/OFF for runtime state. Gateway engine advanced is for low-level repair and diagnostics.\n'));
            await pause();
        }
    }
};

export default netGetXSettingsMenu;
