import chalk from 'chalk';
import inquirer from 'inquirer';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import { manageGateway } from './gatewayPM2.js';
import { addNewGateway } from './addGateway.cli.js';
import { deleteGateway, loadOrCreateGConfig } from './config/gConfig.js';
import pm2 from 'pm2';

export async function Gateways_CLI(g) {
    console.clear();  // Clear the console when entering the Gateways menu
    console.log(chalk.green('Gateways Menu'));

    while (true) {
        const gatewayNames = g.gateways.map(gateway => gateway.name);
        const mainMenuOptions = [
            ...gatewayNames,
            'Add Gateway',
            'Go Back'  // Added Go Back option
        ];

        const { mainMenuSelection } = await inquirer.prompt({
            type: 'list',
            name: 'mainMenuSelection',
            message: 'Select an option:',
            choices: mainMenuOptions,
        });

        switch (mainMenuSelection) {
            case 'Go Back':
                console.clear();  // Clear the console when going back to the main menu
                console.log(chalk.blue('Returning to the main menu...'));
                await NetGetMainMenu();
                return;

            case 'Add Gateway':
                console.clear();  // Clear the console when adding a new gateway
                console.log(chalk.blue('Adding a new gateway...'));
                g = await addNewGateway();  // Update the g object with the new gateway
                break;

            default:
                const selectedGateway = g.gateways.find(gateway => gateway.name === mainMenuSelection);
                if (selectedGateway) {
                    console.clear();  // Clear the console before showing gateway actions
                    await showGatewayActions(selectedGateway);
                }
                break;
        }
    }
}

async function showGatewayActions(gateway) {
    await displayGatewayStatus(gateway.name);

    while (true) {
        const actions = [
        'start', 
        'stop', 
        'restart', 
        'delete', 
        'status', 
        'logs', 
        'Go Back']; 

        const { action } = await inquirer.prompt({
            type: 'list',
            name: 'action',
            message: `Select an action for ${gateway.name}:`,
            choices: actions,
        });

        if (action === 'Go Back') {
            console.clear();  // Clear the console when going back to the previous menu
            return;  // Exit the loop to go back to the previous menu
        }

        console.clear();  // Clear the console before performing an action
        try {

            if (action === 'delete') {
                const { confirmDelete } = await inquirer.prompt({
                    type: 'confirm',
                    name: 'confirmDelete',
                    message: `Are you sure you want to delete ${gateway.name}?`,
                    default: false,
                });
    
                if (!confirmDelete) {
                    console.log(chalk.blue('Gateway deletion canceled.'));
                    continue;  // Skip the rest of the loop and prompt for another action
                } else {
                    try {
                        console.log(chalk.blue(`Deleting gateway ${gateway.name}...`));
                        // Remove the gateway from the configuration
                        deleteGateway(gateway.name);
                        console.log(chalk.green(`Gateway ${gateway.name} deleted successfully.`));
                        return;  // Exit the loop after deleting the gateway
                    } catch (error) {
                        console.error(chalk.red(`Error deleting gateway ${gateway.name}: ${error}`));
                    }
                }
            }
    

            // const result = await manageGateway(gateway.name, action);  // Pass the gateway name and action to manageGateway

            // Display the result of the action
            console.log(chalk.blue(`Result of ${action} action:`));
            console.log(result);
        } catch (error) {
            console.error(chalk.red(`Error during ${action} action: ${error}`));
        }

        // Clear the console and redisplay the status after performing an action
        // if (action !== 'status' && action !== 'logs') {
        //     console.clear();
        //     await displayGatewayStatus(gateway.name);
        // }
    }
}

async function displayGatewayStatus(gatewayName) {
    return new Promise((resolve) => {
        pm2.connect((err) => {
            if (err) {
                console.error(chalk.red('PM2 connection error:'), err);
                process.exit(2);
            }

            pm2.describe(gatewayName, (err, desc) => {
                if (err) {
                    console.error(chalk.red(`Failed to get status for ${gatewayName}`), err);
                } else if (desc && desc.length > 0) {
                    const statusInfo = desc[0].pm2_env;
                    const procInfo = desc[0].monit; // Contains CPU and memory usage

                    console.log(chalk.blue(`Current status of ${gatewayName}:`));

                    const formatLine = (label, value) => `${chalk.bold(label.padEnd(20, ' '))}: ${chalk.green(value || 'N/A')}`;

                    let statusOutput = '';

                    statusOutput += formatLine('Name', statusInfo.name) + '\n';
                    statusOutput += formatLine('PID', desc[0].pid || 'N/A') + '\n';  // Using desc[0].pid for PID
                    statusOutput += formatLine('Port', statusInfo.env.PORT || 'N/A') + '\n'; // Add port information
                    statusOutput += formatLine('Status', statusInfo.status) + '\n';
                    if (statusInfo.pm_uptime) {
                        const uptime = Date.now() - statusInfo.pm_uptime;
                        const uptimeFormatted = `${Math.floor(uptime / (1000 * 60 * 60))}h ${Math.floor((uptime / (1000 * 60)) % 60)}m`;
                        statusOutput += formatLine('Started at', new Date(statusInfo.pm_uptime).toLocaleString()) + '\n';
                        statusOutput += formatLine('Uptime', uptimeFormatted) + '\n';
                    }
                    statusOutput += formatLine('Restarts', statusInfo.restart_time) + '\n';
                    if (procInfo) {
                        statusOutput += formatLine('CPU', `${procInfo.cpu}%`) + '\n';
                        statusOutput += formatLine('Memory', `${(procInfo.memory / 1024 / 1024).toFixed(2)} MB`) + '\n';
                    }
                    statusOutput += formatLine('User', statusInfo.username) + '\n';
                    statusOutput += formatLine('Watching', statusInfo.watch ? 'Yes' : 'No') + '\n';

                    console.log(statusOutput.trim());
                } else {
                    console.log(chalk.yellow(`${gatewayName} is not currently managed by PM2.`));
                }
                pm2.disconnect(); // Disconnects from PM2
                resolve();
            });
        });
    });
}
