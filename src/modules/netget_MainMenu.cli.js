// netget_MainMenu.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './NetGetX/config/i_DefaultNetGetX.js';
import  NetGetX_CLI  from './NetGetX/NetGetX.cli.js';
import { i_DefaultGateway } from './Gateways/config/i_DefaultGateway.js';
import { App_CLI } from './Gateways/gateways.cli.js';
import { PortManagement_CLI } from './PortManagement/portManagement.cli.js';
//import { handleAccessPoints } from './AccessPoints/AccessPoints.js';
//import { handleGets } from './Gets/Gets.js';
/**
 * the NetGet CLI.
 */
export default async function NetGetMainMenu() {
    console.log(`
    ╔╗╔┌─┐┌┬┐╔═╗┌─┐┌┬┐
    ║║║├┤  │ ║ ╦├┤  │ 
    ╝╚╝└─┘ ┴ ╚═╝└─┘ ┴ 
        v2.5`);
    const answers = await inquirer.prompt([
    {
        type: 'list',
        name: 'action',
        message: 'Main Menu',
        choices: [
            'X (HTTPS, Domains and Routes)',
            '/srv/ (Port Services)',
            '/var/www (Static)',
            new inquirer.Separator(),
            'Port Management',
            new inquirer.Separator(),
            'Exit',
            new inquirer.Separator()],
    },
    ]);

    switch (answers.action) {
        case 'X (HTTPS, Domains and Routes)':
            const x = await i_DefaultNetGetX();
            if (x) {
                    await NetGetX_CLI(x); 
                    } else {
                    console.log(chalk.red('Setup verification failed. Please resolve any issues before proceeding.'));
                    }
            break;

            case '/srv/ (Port Services)':
                const g = await i_DefaultGateway(); //Load production configuration
                if (g) {
                    console.log(`
                       __________________ 
                      |   The GATEWAY    |---->>
                      |_______...________|
      PORT:3432--- >>>|_______...________|---->>>  ${chalk.green(g)}
                      |_______...________|---->>>
                      |_______...________|---->>>
                    `);
                    await App_CLI(g);  // Pass the development flag to the CLI
                } else {
                    console.log(chalk.red('Setup verification failed. Please resolve any issues before proceeding.'));
                }
                break;

        case '/var/www (Static)':
            console.log(chalk.yellow('Selected Gets'));
            // Call Gets functionality here
            break;

        case 'Port Management':
            await PortManagement_CLI();
            break;
    
        case 'Exit':
            console.log(chalk.green('Exiting NetGet CLI.'));
            process.exit();
    }
}