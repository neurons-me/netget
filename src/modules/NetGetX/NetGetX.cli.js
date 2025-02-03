//netget/src/modules/NetGetX/NetGetX.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './config/i_DefaultNetGetX.js';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import netGetXSettingsMenu from './NetGetX_Settings.cli.js'; 
import domainsMenu from './Domains/domains.cli.js';

/**
 * NetGetX_CLI
 * @memberof module:NetGetX 
 */
export default async function NetGetX_CLI(x) {
    console.log(`
     ██╗  ██╗ 
     ╚██╗██╔╝ .publicIP: ${chalk.green(x.publicIP)}
      ╚███╔╝  .localIP: ${chalk.green(x.localIP)}
      ██╔██╗  .mainServer: ${chalk.green('netget.site')} 
     ██╔╝ ██╗ 
     ╚═╝  ╚═╝ `); 
    x = x ?? await i_DefaultNetGetX();
    let exit = false;
    while (!exit) {
        const answers = await inquirer.prompt({
            type: 'list',
            name: 'option',
            message: 'Select an action:',
            choices: [
                '1. Domains and Certificates (Manage domains and SSL certificates)',
                '2. Settings',
                '3. Back to Main Menu',
                '0. Exit'
            ]
        });

        switch (answers.option) {
            case '1. Domains and Certificates (Manage domains and SSL certificates)':
                console.clear();
                await domainsMenu();
                break;
            case '2. Settings':
                await netGetXSettingsMenu(x);
                break;
            case '3. Back to Main Menu':
                console.log(chalk.blue('Returning to the main menu...'));
                await NetGetMainMenu();
                break;
            case '0. Exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit(); 
            default:
                console.log(chalk.red('Invalid choice, please try again.'));
                break;
        }
    }
};
