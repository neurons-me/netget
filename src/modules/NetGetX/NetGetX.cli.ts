//netget/src/modules/NetGetX/NetGetX.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import open from 'open';
import { i_DefaultNetGetX } from './config/i_DefaultNetGetX.ts';
import { XStateData } from './xState.ts';
import NetGetMainMenu from '../netget_MainMenu.cli.ts';
import netGetXSettingsMenu from './NetGetX_Settings.cli.ts';
import domainsMenu from './Domains/domains.cli.ts';
// import LocalNetgetCLI from '../../../local.netget/backend/local.netget.cli.js';

interface MenuAnswers {
    option: string;
}

/**
 * NetGetX_CLI
 * @memberof module:NetGetX 
 */
export default async function NetGetX_CLI(x?: XStateData): Promise<void> {
    console.clear();
    console.log(`
     ██╗  ██╗ 
     ╚██╗██╔╝ .publicIP: ${chalk.green(x?.publicIP || 'Not Set')}
      ╚███╔╝  .localIP: ${chalk.green(x?.localIP || 'Not Set')}
      ██╔██╗  .mainServer: ${chalk.green('' + (x?.mainServerName || 'Not Set'))} 
     ██╔╝ ██╗ 
     ╚═╝  ╚═╝ `);
    
    if (!x) {
        const result = await i_DefaultNetGetX();
        x = result as XStateData;
    }
    
    if (x.localIP === 'local.netget') {
        console.log(chalk.blue('Initiating server in browser...'));
        await open('http://local.netget');
    }
    
    let exit: boolean = false;
    while (!exit) {
        // Check if main server is set in config
        const mainServerSet: boolean = !!(x.mainServerName && typeof x.mainServerName === 'string' && x.mainServerName.trim() !== '');
        
        if (!mainServerSet) {
            console.log(chalk.red('Main server is not configured!'));
            console.log(chalk.yellow('Please set the main server name using: ') + chalk.cyan('Settings > Main Server Configuration > Edit Main Server Name'));
            console.log(chalk.gray('Local.Netget option will remain locked until you set the main server.'));
        }
        
        const menuChoices: any[] = [
            '1. Domains and Certificates (Manage domains and SSL certificates)',
            mainServerSet
                ? '2. Local.Netget (Start Local Dev Server)'
                : { name: chalk.gray('2. Local.Netget (Set Main Server First)'), disabled: 'Main server not set' },
            '3. Settings',
            '4. Back to Main Menu',
            '0. Exit'
        ];
        
        const answers = await inquirer.prompt<MenuAnswers>({
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
                console.log(chalk.yellow('Local.Netget CLI temporarily disabled during TypeScript migration'));
                // await LocalNetgetCLI();
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
}