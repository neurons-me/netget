// nginx_menu.cli.js
// NGINX Management Menu 
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getState } from '../xState.js';
import nginxRestart from './restartNginx.js';
import { checkNginxStatus } from './checkNginxStatus.js';
import viewNginxLogs from './viewNginxLogs.js';
import stopNginx from './stopNginx.js';
import startNginx from './startNginx.js';
import reloadNginx from './reloadNginx.js';
import NetGetX_CLI from '../NetGetX.cli.js';
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Application specific logging, throwing an error, or other logic here
});

// Main function to display NGINX management menu
export default async function nginxMenu() {
    const x = getState();
    console.log(chalk.green('NGINX Management Menu'));
    const answers = await inquirer.prompt({
        type: 'list',
        name: 'nginxAction',
        message: 'Select NGINX operation:',
        choices: [
            'NGINX Status',
            'Start NGINX',
            'Stop NGINX',
            'Restart NGINX',
            'Reload NGINX',
            'View NGINX Logs',
            'Back to NetGetX Menu'
        ]
    });

    switch (answers.nginxAction) {
        case 'NGINX Status':
            await checkNginxStatus(x);
            break;

        case 'Start NGINX':
            try {
                const success = await startNginx(x);
                if (!success) {
                    console.log(chalk.red('NGINX start operation failed.'));
                }
            } catch (error) {
                console.error(chalk.red(`Error during NGINX start operation: ${error.message}`));
            }
            break;

        case 'Stop NGINX':
            try {
                const success = await stopNginx(x);
                if (!success) {
                    console.log(chalk.red('NGINX stop operation failed.'));
                }
            } catch (error) {
                console.error(chalk.red(`Error during NGINX stop operation: ${error.message}`));
            }
            break;

        case 'Restart NGINX':
            try {
                const success = await nginxRestart(x);
                if (!success) {
                    console.log(chalk.red('NGINX restart operation failed.'));
                }
            } catch (error) {
                console.error(chalk.red(`Error during NGINX restart operation: ${error.message}`));
            }
            break;

        case 'Reload NGINX':
            try {
                const success = await reloadNginx(x);
                if (!success) {
                    console.log(chalk.red('NGINX reload operation failed.'));
                }
            } catch (error) {
                console.error(chalk.red(`Error during NGINX reload operation: ${error.message}`));
            }
            break;

        case 'View NGINX Logs':
            try {
                await viewNginxLogs(x);
            } catch (error) {
                console.error(chalk.red(`Error executing command: ${error.message}`));
            }
            break;

            
            case 'Back to NetGetX Menu':
            //const x = await i_DefaultNetGetX();
            await NetGetX_CLI(x);
            return; // Exit to prevent loop
    }

    // Recursive call to show the menu again unless going back to main menu
    await nginxMenu();
}

// Execute shell commands and handle stdout, stderr, and errors
async function execCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Command failed: ${error.message}`));
                return;
            }
            if (stderr) {
                reject(new Error(`Error during command execution: ${stderr}`));
                return;
            }
            resolve(stdout);
        });
    });
}
