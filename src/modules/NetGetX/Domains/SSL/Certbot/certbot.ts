import { exec } from 'child_process';
import chalk from 'chalk';
import { handlePermission } from '../../../../utils/handlePermissions.ts'; 

/**
 * Print the latest Certbot logs.
 * @memberof module:NetGetX
 * @returns Promise that resolves when logs are printed.
 */
const printCertbotLogs = async (): Promise<void> => {
    try {
        const stdout: string = await execShellCommand('sudo tail -n 50 /var/log/letsencrypt/letsencrypt.log');
        console.log(chalk.green('Latest Certbot logs:'));
        console.log(stdout);
    } catch (error: any) {
        if (error.message.includes('Permission denied')) {
            const manualInstructions = 'Please check the permissions of the log file and ensure you have read access.';
            await handlePermission('retrieving Certbot logs', 'sudo tail -n 50 /var/log/letsencrypt/letsencrypt.log', manualInstructions);
        } else {
            console.error(chalk.red(`Failed to retrieve Certbot logs: ${error.message}`));
        }
    }
};

/**
 * Executes a shell command and returns the output as a promise.
 * 
 * @function execShellCommand
 * @memberof module:NetGetX
 * @param cmd - The shell command to execute.
 * @returns A promise that resolves with the command's stdout or stderr.
 * @throws Will throw an error if the command execution fails.
 */
const execShellCommand = (cmd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout ? stdout : stderr);
            }
        });
    });
};

export default printCertbotLogs;