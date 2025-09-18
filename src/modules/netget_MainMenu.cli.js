// netget_MainMenu.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './NetGetX/config/i_DefaultNetGetX.js';
import NetGetX_CLI from './NetGetX/NetGetX.cli.js';
import { Srvrs_CLI } from './Srvrs/srvrs.cli.js';
import { PortManagement_CLI } from './PortManagement/portManagement.cli.js';
import netGetXDeployMenu from './NetGet_deploy/NetGetX_DeployMenu.cli.js';

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

export default async function NetGetMainMenu() {
    console.clear();
    console.log(`
    ╔╗╔┌─┐┌┬┐╔═╗┌─┐┌┬┐
    ║║║├┤  │ ║ ╦├┤  │ 
    ╝╚╝└─┘ ┴ ╚═╝└─┘ ┴ 
        v2.6.44`);
    console.log(chalk.yellow('Note: This system will only work correctly if it is mounted on a public IP address.'));
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Main Menu',
            choices: [
                'NetGetX',
                'NetGet Deploy',
                //'Srvrs - (Port Services)',
                //'Statics - (Static files)',
                new inquirer.Separator(),
                'Port Management',
                new inquirer.Separator(),
                'Exit',
                new inquirer.Separator()],
        },
    ]);

    switch (answers.action) {
        case 'NetGetX':
            const x = await i_DefaultNetGetX();
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
            await netGetXDeployMenu();
            break;

        case 'Srvrs - (Port Services)':
            /*
            Role: Manages and adds backend services listening on specific ports.
            */
            await Srvrs_CLI();
            break;

        case 'Statics - (Static files)':
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