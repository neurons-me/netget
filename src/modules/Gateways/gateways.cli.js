import chalk from 'chalk';
import inquirer from 'inquirer';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import { addNewGateway } from './addGateway.cli.js';
import { showGatewayActions, } from './utils.js';
import { loadOrCreateGConfig } from './config/gConfig.js';

/**
 * Displays the Gateways Menu and handles user input.
 * @category Gateways
 * @subcategory Main    
 * @module Gateways_CLI
 */

export async function Gateways_CLI() {
    console.clear();
    console.log(chalk.green('Gateways Menu'));
    try{
        const gConfig = await loadOrCreateGConfig();
        const gateways = gConfig.gateways;

        if (gateways.length === 0) {
            console.log(chalk.red('No gateways configured.'));
        }
        
        const mainMenuOptions = [
            new inquirer.Separator(),
            ...gateways.map(gateway => gateway.name),
            new inquirer.Separator(),
            'Add Gateway',
            'Go Back'
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

            case 'Add Gateway':
                console.clear();
                console.log(chalk.blue('Adding a new gateway...'));
                await addNewGateway();
                await Gateways_CLI();
                return;

            default:
                const selectedGateway = gateways.find(gateway => gateway.name === mainMenuSelection);
                if (selectedGateway) {
                    console.clear();
                    await showGatewayActions(selectedGateway);
                };
                
        }
    }
    catch (error) {
        console.error(chalk.red('An error occurred in the Gateways Menu:', error.message));
    }
};
