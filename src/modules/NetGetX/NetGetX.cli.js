//netget/src/modules/NetGetX/NetGetX.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import open from 'open';
import { i_DefaultNetGetX } from './config/i_DefaultNetGetX.js';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import netGetXSettingsMenu from './NetGetX_Settings.cli.js'; 
import domainsMenu from './Domains/domains.cli.js';
import LocalNetgetCLI from '../../../local.netget/backend/local.netget.cli.js';

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
    if (x.localIP === 'local.netget') {
        console.log(chalk.blue('Initiating server in browser...'));
        await open('http://local.netget');
    }
    let exit = false;
    while (!exit) {
        // Check if main server is set in config
        const mainServerSet = x.mainServerName && typeof x.mainServerName === 'string' && x.mainServerName.trim() !== '';
        if (!mainServerSet) {
            console.log(chalk.red('Main server is not configured!'));
            console.log(chalk.yellow('Please set the main server name using: ') + chalk.cyan('Settings > Main Server Configuration Edit Main Server Name'));
            console.log(chalk.gray('Local.Netget option will remain locked until you set the main server.'));
        }
        const menuChoices = [
            '1. Domains and Certificates (Manage domains and SSL certificates)',
            mainServerSet
                ? '2. Local.Netget (Start Local Dev Server)'
                : { name: chalk.gray('2. Local.Netget (Set Main Server First)'), disabled: 'Main server not set' },
            '3. Settings',
            '4. Back to Main Menu',
            '0. Exit'
        ];
        const answers = await inquirer.prompt({
            type: 'list',
            name: 'option',
            message: 'Select an action:',
            choices: menuChoices
        });

        switch (answers.option) {
            case '1. Domains and Certificates (Manage domains and SSL certificates)':
                console.clear();
                await domainsMenu();
                break;

            case '2. Local.Netget (Start Local Dev Server)':
                if (!mainServerSet) {
                    console.log(chalk.red('You must set the main server before starting Local.Netget. Go to Settings > Edit Main Server Name.'));
                    break;
                }
                console.clear();
                await LocalNetgetCLI(x);
                break;

            case '3. Settings':
                console.clear();
                await netGetXSettingsMenu(x);
                break;
            case '4. Back to Main Menu':
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
