//netget/src/modules/NetGetX/NetGetX.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import mainServerMenu from './mainServer/mainServer.cli.js';
import  XBlocksMenu  from './XBlocks/XBlocks.cli.js'; // Import the new addXBlockMenu
import { i_DefaultNetGetX } from './config/i_DefaultNetGetX.js';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import nginxMenu from './NGINX/nginx_menu.cli.js';
import displayStateAndConfig from './config/x_StateAndConfig.js'; // Correct import statement
import netGetXSettingsMenu from './NetGetX_Settings.cli.js'; 
import { getXBlocksList, getXBlocksEnabled } from './XBlocks/XBlocksUtils.js';
import domainsMenu from './Domains/domains.cli.js';
import { parseMainServerName } from './mainServer/utils.js';

export default async function NetGetX_CLI(x) {
    console.clear();
    const { XBlocksAvailable, XBlocksEnabled } = x;
    //availableXBlocks
    const availableXBlocks = getXBlocksList(XBlocksAvailable);
    const formattedXBlocksAvailable = availableXBlocks.length > 0 ? availableXBlocks.join(', ') : 'None';
    //enabledXBlocks
    const enabledXBlocks = getXBlocksEnabled(XBlocksEnabled);
    const formattedXBlocksEnabled = enabledXBlocks.length > 0 ? enabledXBlocks.join(', ') : 'None';
const mainServerName = parseMainServerName(x.nginxPath);
console.log(`Main server name: ${mainServerName}`);
console.log(`.publicIP: ${chalk.green(x.publicIP)}`);
console.log(`.localIP: ${chalk.green(x.localIP)}`)
console.log(`
     ██╗  ██╗ 
     ╚██╗██╔╝ .XBlocks Available: ${chalk.green(formattedXBlocksAvailable)}
      ╚███╔╝  .XBlocks Enabled: ${chalk.green(formattedXBlocksEnabled)}
      ██╔██╗  .OutPort: ${chalk.green(x.xMainOutPutPort)}
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
                'Main Server',
                'Domains and Certificates',
                'Settings',
                'NGINX Menu',
                'xConfig/xState',
                //'Show X Discovery Nodes',
                //'Add New X Discovery Node',
                'About NetGetX',
                'Main Menu',
                'Exit'
            ]
        });

        switch (answers.option) {
            case 'Main Server':
                await mainServerMenu(x);
                break;
            case 'Domains and Certificates':
                console.clear();
                await domainsMenu();
                break;
            case 'NGINX Menu':
                await nginxMenu();
                break;
            case 'Settings':
                await netGetXSettingsMenu(x);
                break;
            case 'xConfig/xState':
                await displayStateAndConfig(x); // Call the function to display the state and config
                break;
            case 'Main Menu':
                console.log(chalk.blue('Returning to the main menu...'));
                await NetGetMainMenu();
                break;
            case 'Show X Discovery Nodes':
                //await showXBlocks(x);
                break; 
            case 'Add New X Discovery Node':
                //await addXBlockMenu(x);
                break; 
            case 'About NetGetX':
                console.log(chalk.blue('NetGetX is a tool for managing NGINX configurations and XBlocks making servers and domain management easy.'));
            //console.log(chalk.blue('Alonzo Church was a mathematician and logician who made major contributions to the field of theoretical computer science.'));   
                break;
            case 'Exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit(); 
            default:
                console.log(chalk.red('Invalid choice, please try again.'));
                break;
        }
    }
};
