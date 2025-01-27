// netget_MainMenu.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './NetGetX/config/i_DefaultNetGetX.js';
import NetGetX_CLI from './NetGetX/NetGetX.cli.js';
import { Srvrs_CLI } from './Srvrs/srvrs.cli.js';
import { PortManagement_CLI } from './PortManagement/portManagement.cli.js';
/**
 * the NetGet CLI.
 */
export default async function NetGetMainMenu() {
    console.clear();
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
                'Srvrs - (Port Services)',
                'Statics - (Static files)',
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