import chalk from 'chalk';
import { exec } from 'child_process';
import { handlePermission } from '../../utils/handlePermissions.js'; // Adjust path as necessary

/**
 * Checks the status of NGINX configuration.
 * @param {Object} x - The configuration object containing paths and settings for NGINX.
 * @category NetGetX
 * @subcategory NGINX
 * @module checkNginxStatus
 */
export async function checkNginxStatus(x) {
    try {
        const nginxCommand = x.nginxExecutable;
        const statusCommand = `${nginxCommand} -t`;

        const checkStatus = async (command) => {
            return new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        reject({ error, stderr });
                    } else {
                        resolve({ stdout, stderr });
                    }
                });
            });
        };

        try {
            const { stdout, stderr } = await checkStatus(statusCommand);
            console.log(chalk.blue(`Output:\n${stdout}`));
            if (stderr && !stderr.includes('Test is successful.')) {
                console.error(chalk.red(`NGINX Error: ${stderr}`));
            } else {
                console.log(chalk.green('NGINX is configured correctly.'));
                if (stderr) {
                    console.log(chalk.yellow(`Notices:\n${stderr}`));
                }
            }
        } catch ({ error, stderr }) {
            if (error.message.includes('Permission denied')) {
                console.error(chalk.red(`Permission denied error: ${error.message}`));
                await handlePermission(
                    "checking NGINX status",
                    `sudo ${statusCommand}`,
                    `To manually check NGINX status, run the following command with elevated privileges:\n${`sudo ${statusCommand}`}`
                );

                // Retry the command with elevated permissions
                const { stdout, stderr } = await checkStatus(`sudo ${statusCommand}`);
                console.log(chalk.blue(`Output:\n${stdout}`));
                if (stderr && !stderr.includes('test is successful')) {
                    console.error(chalk.red(`NGINX Error: ${stderr}`));
                } else {
                    console.log(chalk.green('NGINX is configured correctly.'));
                    if (stderr) {
                        console.log(chalk.yellow(`Notices:\n${stderr}`));
                    }
                }
            } else {
                console.error(chalk.red(`Error checking NGINX status: ${error.message}`));
            }
        }
    } catch (error) {
        console.error(chalk.red(`Failed to load NGINX configuration: ${error?.message || 'Unknown error'}`));
    }
}
