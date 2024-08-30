// netget_MainMenu.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { i_DefaultNetGetX } from './NetGetX/config/i_DefaultNetGetX.js';
import  NetGetX_CLI  from './NetGetX/NetGetX.cli.js';
import { i_DefaultGateway } from './Gateways/config/i_DefaultGateway.js';
import { Gateways_CLI } from './Gateways/gateways.cli.js';
import { PortManagement_CLI } from './PortManagement/portManagement.cli.js';
//import { handleAccessPoints } from './AccessPoints/AccessPoints.js';
//import { handleGets } from './Gets/Gets.js';
/**
 * the NetGet CLI.
 */
console.log(`
Welcome to:
╔╗╔┌─┐┌┬┐╔═╗┌─┐┌┬┐
║║║├┤  │ ║ ╦├┤  │ 
╝╚╝└─┘ ┴ ╚═╝└─┘ ┴ 
`);
console.log(`v2.4.7`);
export default async function NetGetMainMenu() {
    const answers = await inquirer.prompt([
    {
        type: 'list',
        name: 'action',
        message: 'Main Menu:',
        choices: ['NetGetX', 'Gateways', 'Gets', 'AccessPoints',  new inquirer.Separator(), 'Port Management', new inquirer.Separator(), 'Exit', new inquirer.Separator()],
    },
    ]);

    switch (answers.action) {
        case 'NetGetX':
            const x = await i_DefaultNetGetX();
            if (x) {
                    await NetGetX_CLI(x); 
                    } else {
                    console.log(chalk.red('Setup verification failed. Please resolve any issues before proceeding.'));
                    }
            break;

            case 'Gateways':
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
                    await Gateways_CLI(g);  // Pass the development flag to the CLI
                } else {
                    console.log(chalk.red('Setup verification failed. Please resolve any issues before proceeding.'));
                }
                break;

        case 'Gets':
            console.log(chalk.yellow('Selected Gets'));
            // Call Gets functionality here
            break;
        case 'AccessPoints':
            console.log(chalk.magenta('Selected AccessPoints'));
            //await handleAccessPoints();  // Call AccessPoints functionality here
            break;

        case 'Port Management':
            await PortManagement_CLI();
            break;
    
        case 'Exit':
            console.log(chalk.green('Exiting NetGet CLI.'));
            process.exit();
    }
}