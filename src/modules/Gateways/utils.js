import chalk from 'chalk';
import inquirer from 'inquirer';
import pm2 from 'pm2';
import { manageGateway } from './gatewayPM2.js';
import { deleteGateway, saveGConfig, loadOrCreateGConfig } from './config/gConfig.js';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import { Gateways_CLI } from './gateways.cli.js';


async function showGatewayActions(gateway) {
    await displayGatewayStatus(gateway.name);
    const gConfig = await loadOrCreateGConfig();
    while(true) {
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
        
        console.clear();
        try{
            if (action === 'Go Back') {
                console.clear(); 
                await Gateways_CLI();
                return; 
            }

            if (action === 'delete') {
                console.clear();
                await deleteGateway(gateway.name);
                await Gateways_CLI();
                return;
            }

            manageGateway(gateway.name, action);


            if (action !== 'status' && action !== 'logs' && action !== 'delete') {
                console.clear();
                await displayGatewayStatus(gateway.name);
            }
            
            // console.log(chalk.blue(`Result of ${action} action:`));
            // console.log(result);
            
        } catch (error) {
            console.error(chalk.red(`Error during ${action} action: ${error}`));
        }
    }
};


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

export { showGatewayActions, displayGatewayStatus };
