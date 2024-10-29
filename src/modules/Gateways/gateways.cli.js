// netget/src/modules/Gateways/gateways.cli.js
import chalk from 'chalk';
import inquirer from 'inquirer';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import { addNewApp } from './addGateway.cli.js';
import { showAppActions, } from './utils.js';
import { loadOrCreateGConfig } from './config/gConfig.js';

/**
 * Displays the Gateways Menu and handles user input.
 * @category Gateways
 * @subcategory Main    
 * @module App_CLI
 */

export async function App_CLI() {
    console.clear();
    console.log(chalk.green('App Menu'));
    try{
        const gConfig = await loadOrCreateGConfig();
        const gateways = gConfig.gateways;

        if (gateways.length === 0) {
            console.log(chalk.red('No apps configured.'));
        }
        
        const mainMenuOptions = [
            new inquirer.Separator(),
            ...gateways.map(gateway => gateway.name),
            new inquirer.Separator(),
            'Add App',
            'Go Back',
        ];

        const { mainMenuSelection } = await inquirer.prompt({
            type: 'list',
            name: 'mainMenuSelection',
            message: 'Select an option:',
            choices: mainMenuOptions,
        });

        switch (mainMenuSelection) {
            case 'Go Back':
                console.clear();
                console.log(chalk.blue('Returning to the main menu...'));
                await NetGetMainMenu();
                return;

            case 'Add App':
                console.clear();
                console.log(chalk.blue('Adding a new app...'));
                await addNewApp();
                await App_CLI();
                return;

            default:
                const selectedApp = gateways.find(gateway => gateway.name === mainMenuSelection);
                if (selectedApp) {
                    console.clear();
                    await showAppActions(selectedApp);
                };
                
        }
    }
    catch (error) {
        console.error(chalk.red('An error occurred in the Gateways Menu:', error.message));
    }
};
