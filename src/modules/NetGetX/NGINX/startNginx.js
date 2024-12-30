import { exec } from 'child_process';
import chalk from 'chalk';

/**
 * Starts the NGINX server using the provided configuration.
 * @param {Object} config - The configuration object which should include the NGINX executable path.
 * @returns {Promise<boolean>} Promise resolving to true if start was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module startNginx
 */
const startNginx = async (config) => {
    let startCommand;

    // Determine the command based on the operating system
    switch (process.platform) {
        case 'darwin': // macOS
            startCommand = 'brew services start nginx';
            break;
        case 'linux':
            startCommand = 'sudo systemctl start nginx';
            break;
        case 'win32': // Windows
            startCommand = 'nssm start nginx'; // This assumes NGINX is installed as a service named 'nginx'
            break;
        default:
            console.error(chalk.red('Unsupported operating system for automatic start.'));
            return false;
    }

    return execCommand(startCommand);
};

/**
 * Executes a shell command and logs the output or errors.
 * @param {string} command - The command to execute.
 * @returns {Promise<boolean>} Promise resolving to true if command was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module startNginx
 */
const execCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to start NGINX: ${error.message}`));
                reject(false);
                return;
            }
            if (stderr) {
                console.error(chalk.red(`Error during NGINX start: ${stderr}`));
                reject(false);
                return;
            }
            console.log(chalk.green('NGINX started successfully.'));
            resolve(true);
        });
    });
};

export default startNginx;
