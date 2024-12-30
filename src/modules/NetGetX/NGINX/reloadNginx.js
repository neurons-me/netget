import { exec } from 'child_process';
import chalk from 'chalk';

/**
 * Reloads the NGINX server using the provided configuration.
 * @param {Object} config - The configuration object which should include the NGINX executable path.
 * @returns {Promise<boolean>} Promise resolving to true if reload was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module reloadNginx
 */
const reloadNginx = async (config) => {
    const reloadCommand = 'sudo nginx -s reload';

    return execCommand(reloadCommand);
};

/**
 * Executes a shell command and logs the output or errors.
 * @param {string} command - The command to execute.
 * @returns {Promise<boolean>} Promise resolving to true if command was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module reloadNginx
 */
const execCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to reload NGINX: ${error.message}`));
                reject(false);
                return;
            }
            if (stderr) {
                console.error(chalk.red(`Error during NGINX reload: ${stderr}`));
                reject(false);
                return;
            }
            console.log(chalk.green('NGINX reloaded successfully.'));
            resolve(true);
        });
    });
};

export default reloadNginx;
