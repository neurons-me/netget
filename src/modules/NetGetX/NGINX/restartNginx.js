import { exec } from 'child_process';
import chalk from 'chalk';

/**
 * Restarts the NGINX server using the provided configuration.
 * @param {Object} config - The configuration object which should include the NGINX executable path.
 * @returns {Promise<boolean>} Promise resolving to true if restart was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module nginxRestart
 */
const nginxRestart = async (config) => {
    let restartCommand;

    // Determine the command based on the operating system
    switch (process.platform) {
        case 'darwin': // macOS
            restartCommand = 'brew services restart nginx';
            break;
        case 'linux':
            restartCommand = 'sudo systemctl restart nginx';
            break;
        case 'win32 nssm': // Windows
            restartCommand = 'nssm restart nginx'; // This assumes NGINX is installed as a service named 'nginx'
            break;
        default:
            console.error(chalk.red('Unsupported operating system for automatic restart.'));
            return false;
    }

    return execCommand(restartCommand);
};

/**
 * Executes a shell command and logs the output or errors.
 * @param {string} command - The command to execute.
 * @returns {Promise<boolean>} Promise resolving to true if command was successful, false otherwise.
 * @category NetGetX
 * @subcategory NGINX
 * @module nginxRestart
 */
const execCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to restart NGINX: ${error.message}`));
                reject(false);
                return;
            }
            if (stderr) {
                console.error(chalk.red(`Error during NGINX restart: ${stderr}`));
                reject(false);
                return;
            }
            console.log(chalk.green('NGINX restarted successfully.'));
            resolve(true);
        });
    });
};

export default nginxRestart;
