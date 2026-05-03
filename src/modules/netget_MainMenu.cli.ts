// netget_MainMenu.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './NetGetX/config/i_DefaultNetGetX.ts';
import type { XStateData } from './NetGetX/xState.ts';

// Inquirer Choice Interface
interface MenuChoice {
    type: 'list';
    name: 'action';
    message: string;
    choices: Array<string | any>; // Use any for Separator for compatibility
}

// Menu Action Type
type MenuAction =
    | 'Main Server'
    | 'NetGet Deploy'
    | 'Port Management'
    | 'Back'
    | 'Exit CLI';

// Menu Answers Interface
interface MenuAnswers {
    action: MenuAction;
}

function isPromptExitError(err: any): boolean {
    return err?.name === 'ExitPromptError' || String(err?.message || '').includes('force closed the prompt');
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
export default async function NetGetMainMenu(preloadedX?: XStateData | any): Promise<void> {
    try {
        console.clear();
        const x: XStateData | any = preloadedX || await i_DefaultNetGetX();
        console.log(`
        ╔╗╔┌─┐┌┬┐╔═╗┌─┐┌┬┐
        ║║║├┤  │ ║ ╦├┤  │ 
        ╝╚╝└─┘ ┴ ╚═╝└─┘ ┴ 
            v2.6.51`);
        console.log(chalk.yellow('Note: This system will only work correctly if it is mounted on a public IP address.'));
        console.log('Dashboard: ' + chalk.green('http://local.netget'));
        // Build the menu choices dynamically depending on global/local mode
        const baseChoices: Array<string | any> = [
            'Main Server',
            new inquirer.Separator(),
        ];
        
        const mainServerSet: boolean = !!(x.mainServerName && typeof x.mainServerName === 'string' && x.mainServerName.trim() !== '');

        if (mainServerSet) {
            baseChoices.push('NetGet Deploy');
        }

        // Add some common items
        baseChoices.push(
            'Port Management',
            new inquirer.Separator()
        );

        baseChoices.push(new inquirer.Separator(), 'Back', 'Exit CLI', new inquirer.Separator());

        const menuQuestion: MenuChoice = {
            type: 'list',
            name: 'action',
            message: 'Main Menu',
            choices: baseChoices,
        };

        const answers: MenuAnswers = await inquirer.prompt([menuQuestion]);

        switch (answers.action) {
            case 'Main Server':
                if (x) {
                    /*
                    Netget X (The Router/Conductor)
                    Role: Acts as the central orchestrator,
                    running an Nginx server and managing domain routing.
                    */
                    const { default: NetGetX_CLI } = await import('./NetGetX/NetGetX.cli.ts');
                    await NetGetX_CLI(x);
                    break;
                } else {
                    console.log(chalk.red('Setup verification failed. Please resolve any issues before proceeding.'));
                }
                break;
                
            case 'NetGet Deploy':
                const { default: netGetXDeployMenu } = await import('./NetGet-Deploy/NetGetX_DeployMenu.cli.ts');
                await netGetXDeployMenu();
                break;

            case 'Port Management':
                const { PortManagement_CLI } = await import('./PortManagement/portManagement.cli.ts');
                await PortManagement_CLI();
                break;

            case 'Back':
                return;

            case 'Exit CLI':
                console.log(chalk.green('Exiting NetGet CLI.'));
                process.exit(0);
                break;
                
            default:
                console.log(chalk.red('Invalid selection'));
                await NetGetMainMenu();
                break;
        }
    } catch (err: any) {
        if (isPromptExitError(err)) {
            console.log(chalk.gray('\nPrompt closed. Bye.'));
            process.exit(0);
        }
        console.log(chalk.red('An error occurred:'), err.message);
        console.log(chalk.yellow('Stack trace:'), err.stack);
        // Optionally, prompt user to return to menu or exit
        process.exit(1);
    }
}
