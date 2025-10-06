// netget_MainMenu.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './NetGetX/config/i_DefaultNetGetX.ts';
import NetGetX_CLI from './NetGetX/NetGetX.cli.ts';
// import { Srvrs_CLI } from './Srvrs/srvrs.cli.js';  // Temporarily disabled
// import { PortManagement_CLI } from './PortManagement/portManagement.cli.js'; // Temporarily disabled
// import netGetXDeployMenu from './NetGet_deploy/NetGetX_DeployMenu.cli.js'; // Temporarily disabled
import { XStateData } from './NetGetX/xState.ts';

// Inquirer Choice Interface
interface MenuChoice {
    type: 'list';
    name: 'action';
    message: string;
    choices: Array<string | any>; // Use any for Separator for compatibility
}

// Menu Action Type
type MenuAction = 
    | 'NetGetX' 
    | 'NetGet Deploy' 
    | 'Port Management' 
    | 'Srvrs - (Port Services)' 
    | 'Statics - (Static files)' 
    | 'Exit';

// Menu Answers Interface
interface MenuAnswers {
    action: MenuAction;
}

/**
 * Entry point of NetGet node module.
 * @module NetGetX
 */

/**
 * This module provides a command-line interface (CLI) for managing network ports.
 * It allows users to check which processes are running on a specific port and to kill processes running on a specified port.
 * The module integrates with PM2 to manage processes that are started by PM2.
 * @module PortManagement
 */ 

/**
 * This module provides functions to manage NGINX configuration paths and executable paths.
 * It includes methods to detect and set these paths in a user configuration object.
 * The module is designed to work across different operating systems, enhancing compatibility.
 * @namespace NginxConfiguration
 * @memberof module:NetGetX
 */

/**
 * @namespace Config
 * @memberof module:NetGetX
 */

/**
 * @namespace SSL
 * @memberof module:NetGetX
 */

/**
 * @namespace Domains
 * @memberof module:NetGetX
 */

/**
 * @namespace OpenResty
 * @memberof module:NetGetX
 */ 

/**
 * @namespace Utils
 * @memberof module:NetGetX
 */

/**
 * Main menu function for NetGet CLI
 * @returns Promise<void>
 */
export default async function NetGetMainMenu(): Promise<void> {
    try {
        console.clear();
        console.log(`
        ╔╗╔┌─┐┌┬┐╔═╗┌─┐┌┬┐
        ║║║├┤  │ ║ ╦├┤  │ 
        ╝╚╝└─┘ ┴ ╚═╝└─┘ ┴ 
            v2.6.46`);
        console.log(chalk.yellow('Note: This system will only work correctly if it is mounted on a public IP address.'));
        
        const menuQuestion: MenuChoice = {
            type: 'list',
            name: 'action',
            message: 'Main Menu',
            choices: [
                'NetGetX',
                'NetGet Deploy',
                new inquirer.Separator(),
                'Port Management',
                new inquirer.Separator(),
                'Srvrs - (Port Services)',
                'Statics - (Static files)',
                new inquirer.Separator(),
                'Exit',
                new inquirer.Separator()
            ],
        };

        const answers: MenuAnswers = await inquirer.prompt([menuQuestion]);

        switch (answers.action) {
            case 'NetGetX':
                const x: XStateData | any = await i_DefaultNetGetX();
                if (x) {
                    /*
                    Netget X (The Router/Conductor)
                    Role: Acts as the central orchestrator,
                    running an Nginx server and managing domain routing.
                    */
                    await NetGetX_CLI(x);
                    break;
                } else {
                    console.log(chalk.red('Setup verification failed. Please resolve any issues before proceeding.'));
                }
                break;
                
            case 'NetGet Deploy':
                console.clear();
                console.log(chalk.yellow('NetGet Deploy temporarily disabled during TypeScript migration.'));
                await NetGetMainMenu();
                break;

            case 'Port Management':
                console.log(chalk.yellow('Port Management temporarily disabled during TypeScript migration.'));
                await NetGetMainMenu();
                break;

            case 'Srvrs - (Port Services)':
                /*
                Role: Manages and adds backend services listening on specific ports.
                */
                console.log(chalk.yellow('Srvrs temporarily disabled during TypeScript migration.'));
                await NetGetMainMenu();
                break;

            case 'Statics - (Static files)':
                console.log(chalk.yellow('Still in development...'));
                // Call Gets functionality here
                await NetGetMainMenu();
                break;

            case 'Exit':
                console.log(chalk.green('Exiting NetGet CLI.'));
                process.exit(0);
                break;
                
            default:
                console.log(chalk.red('Invalid selection'));
                await NetGetMainMenu();
                break;
        }
    } catch (err: any) {
        console.log(chalk.red('An error occurred:'), err.message);
        console.log(chalk.yellow('Stack trace:'), err.stack);
        // Optionally, prompt user to return to menu or exit
        process.exit(1);
    }
}