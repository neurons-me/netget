import chalk from 'chalk';
import inquirer from 'inquirer';
import pm2 from 'pm2';
import { spawn } from 'child_process';
import { manageApp } from './gatewayPM2.js';
import { deleteApp, loadOrCreateGConfig } from './config/gConfig.js';
import { App_CLI } from './gateways.cli.js';
import NetGetMainMenu from '../netget_MainMenu.cli.js';


async function showAppActions(app) {
    await displayAppStatus(app.name);
    const gConfig = await loadOrCreateGConfig();
    while(true) {
        const actions = [
        'start', 
        'stop', 
        'restart', 
        'delete', 
        new inquirer.Separator(),
        'Dev Mode', 
        'Go Back',
        new inquirer.Separator()]; 
        
        const { action } = await inquirer.prompt({
            type: 'list',
            name: 'action',
            message: `Select an action for ${app.name}:`,
            choices: actions,
        });
        
        console.clear();
        try{
            if (action === 'delete') {
                console.clear();
                await deleteApp(app.name);
                manageApp(app.name, 'delete');
                await App_CLI();
                return;
            }

            if (action === 'Go Back') {
                console.clear(); 
                await App_CLI();
                return; 
            }

            if (action === 'Dev Mode') {
                console.clear();
                await startAppInDevMode(app);
            }

            
            if (action !== 'delete' && action !== 'Dev Mode') {
                console.clear();
                manageApp(app.name, action);
                await displayAppStatus(app.name);
            }
            
            // console.log(chalk.blue(`Result of ${action} action:`));
            // console.log(result);
            
        } catch (error) {
            console.error(chalk.red(`Error during ${action} action: ${error}`));
        }
    }
};

// Function to start the app in Development Mode using pm2
async function startAppInDevMode(app) {
    manageApp(app.name, 'stop');
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(chalk.red('PM2 connection error:'), err);
                return reject(err);
            }

            const devCommand = `pm2-dev ${app.script}`;
            let terminalCommand;

            if (process.platform === 'darwin') {
                terminalCommand = `osascript -e 'tell application "Terminal" to do script "${devCommand}"'`;
            } else if (process.platform === 'win32') {
                terminalCommand = `start cmd.exe /K "${devCommand}"`;
            } else {
                terminalCommand = `x-terminal-emulator -e "${devCommand}"`;
            }

            const child = spawn(terminalCommand, { shell: true });

            child.stdout.on('data', (data) => {
                console.log(chalk.green(data.toString()));
            });

            child.stderr.on('data', (data) => {
                console.error(chalk.red(data.toString()));
            });

            child.on('close', async (code) => {
                pm2.disconnect();
                if (code === 0) {
                    resolve();
                } else {
                    await App_CLI()
                }
            });
        });
    });
}

async function displayAppStatus(gatewayName) {
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

export { showAppActions, displayAppStatus };
