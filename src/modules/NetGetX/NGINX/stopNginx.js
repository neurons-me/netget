import { exec } from 'child_process';
import chalk from 'chalk';

/**
 * Stops the NGINX server using the provided configuration.
 * @param {Object} config - The configuration object which should include the NGINX executable path.
 * @returns {Promise<boolean>} Promise resolving to true if stop was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module stopNginx
 */
const stopNginx = async (config) => {
    let stopCommand;

    // Determine the command based on the operating system
    switch (process.platform) {
        case 'darwin': // macOS
            stopCommand = 'brew services stop nginx';
            break;
        case 'linux':
            stopCommand = 'sudo systemctl stop nginx';
            break;
        case 'win32': // Windows
            stopCommand = 'nssm stop nginx'; // This assumes NGINX is installed as a service named 'nginx'
            break;
        default:
            console.error(chalk.red('Unsupported operating system for automatic stop.'));
            return false;
    }

    return execCommand(stopCommand);
};

/**
 * Executes a shell command and logs the output or errors.
 * @param {string} command - The command to execute.
 * @returns {Promise<boolean>} Promise resolving to true if command was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module stopNginx
 */
const execCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to stop NGINX: ${error.message}`));
                reject(false);
                return;
            }
            if (stderr) {
                console.error(chalk.red(`Error during NGINX stop: ${stderr}`));
                reject(false);
                return;
            }
            console.log(chalk.green('NGINX stopped successfully.'));
            resolve(true);
        });
    });
};

export default stopNginx;
