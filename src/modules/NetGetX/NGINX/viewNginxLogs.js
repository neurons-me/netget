import { spawn } from 'child_process';
import chalk from 'chalk';

/**
 * View NGINX logs based on the provided configuration.
 * @param {Object} config - The configuration object which should include the NGINX log path.
 * @returns {Promise<void>} Promise resolving when the command execution is complete.
 * @category NetGetX
 * @subcategory NGINX
 * @module viewNginxLogs
 */
const viewNginxLogs = async (config) => {
    const logCommand = process.platform === 'win32' ? 'type' : 'less';
    const logPath = config.nginxLogPath || '/var/log/nginx/error.log';

    return execCommandInteractive(`${logCommand} ${logPath}`);
};

/**
 * Executes an interactive shell command and handles the output.
 * @param {string} command - The command to execute.
 * @returns {Promise<void>} Promise resolving when the command execution is complete.
 * @category NetGetX
 * @subcategory NGINX
 */
const execCommandInteractive = (command) => {
    return new Promise((resolve, reject) => {
        const [cmd, ...args] = command.split(' ');
        const child = spawn(cmd, args, { stdio: 'inherit' });

        child.on('error', (error) => {
            console.error(chalk.red(`Failed to execute command: ${error.message}`));
            reject();
        });

        child.on('exit', (code) => {
            if (code !== 0) {
                console.error(chalk.red(`Command exited with code: ${code}`));
                reject();
            } else {
                resolve();
            }
        });
    });
};

export default viewNginxLogs;
