// netget/src/modules/NetGetX/config/updateNginxConfig.js
import fs from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { exec } from 'child_process';
import os from 'os';
import xDefaultServerBlock from '../mainServer/xDefaultServerBlock.js';
import { loadOrCreateXConfig } from '../config/xConfig.js';
import { getDomainByName } from '../../../sqlite/utils_sqlite3.js';

/**
 * Updates the NGINX configuration for a domain by writing the new configuration to the server block file.
 * 
 * @param {string} domain - The domain for which to update the NGINX configuration.
 * @param {string} nginxConfig - The new NGINX configuration to write.
 * @category NetGetX
 */
const viewNginxConfig = async (domain) => {
    const xConfig = await loadOrCreateXConfig();
    const domainConfig = xConfig.domains[domain];

    if (!domainConfig) {
        console.log(chalk.red(`Domain ${domain} configuration not found.`));
        return;
    }
    const dbDomainConfig = await getDomainByName(domain);
    console.log(chalk.blue(`Current NGINX configuration for ${domain} from database:`));
    console.log(chalk.green(dbDomainConfig.nginxConfig));
};

/**
 * Handles permission errors by offering options to retry with elevated privileges,
 * display manual configuration instructions, or cancel the operation.
 * 
 * @param {string} path - The filesystem path where permission was denied.
 * @param {string} data - Data intended to be written to the path.
 * @category NetGetX
 * @subcategory Config
 * @module viewNginxConfig
 */
const handlePermissionError = async (path, data) => {
    const isWindows = os.platform() === 'win32';
    const choices = [
        { name: `Retry with elevated privileges ${isWindows ? '(Run as Administrator)' : '(sudo)'}`, value: 'sudo' },
        { name: 'Display manual configuration instructions', value: 'manual' },
        { name: 'Cancel operation', value: 'cancel' }
    ];

    const { action } = await inquirer.prompt({
        type: 'list',
        name: 'action',
        message: 'Permission denied. How would you like to proceed?',
        choices: choices
    });

    switch (action) {
        case 'sudo':
            await tryElevatedPrivileges(path, data, isWindows);
            break;
        case 'manual':
            displayManualInstructions(path, data, isWindows);
            break;
        case 'cancel':
            console.log(chalk.blue('Operation canceled by the user.'));
            break;
    }
};

/**
 * Attempts to perform an operation with elevated privileges using platform-specific commands.
 * 
 * @param {string} path - The filesystem path where the operation should be performed.
 * @param {string} data - Data to be written or processed.
 * @param {boolean} isWindows - Flag indicating if the operating system is Windows.
 * @category NetGetX
 * @subcategory Config
 * @module updateNginxConfig
 */
const tryElevatedPrivileges = async (path, data, isWindows) => {
    const command = isWindows 
        ? `powershell -Command "Start-Process PowerShell -ArgumentList 'Set-Content -Path ${path} -Value ${escapeDataForShell(data)}' -Verb RunAs"`
        : `echo '${escapeDataForShell(data)}' | sudo tee ${path}`;

    try {
        await execShellCommand(command);
        console.log(chalk.green('Successfully updated NGINX configuration with elevated privileges.'));
    } catch (error) {
        console.error(chalk.red(`Failed with elevated privileges: ${error.message}`));
        displayManualInstructions(path, data, isWindows);
    }
};

/**
 * Escapes shell-specific characters in a string to safely include it in a shell command.
 * 
 * @param {string} data - The data to escape.
 * @returns {string} The escaped data.
 * @category NetGetX
 * @subcategory Config
 * @module updateNginxConfig
 */
const escapeDataForShell = (data) => {
    return data.replace(/'/g, "'\\''");
};

/**
 * Displays manual instructions for configuring NGINX in case of permission errors or user preference.
 * 
 * @param {string} path - The filesystem path related to the instructions.
 * @param {string} data - The data or configuration details to be manually applied.
 * @param {boolean} isWindows - Flag indicating if the operating system is Windows.
 * @category NetGetX
 * @subsection Config
 * @module updateNginxConfig
 */
const displayManualInstructions = (path, data, isWindows) => {
    console.log(chalk.yellow('Please follow these instructions to manually configure the NGINX server block:'));
    if (isWindows) {
        console.info(chalk.blue(`1. Open PowerShell as Administrator.`));
        console.info(chalk.blue(`2. Run the following command:`));
        console.info(chalk.green(`Set-Content -Path ${path} -Value '${data}'`));
    } else {
        console.info(chalk.blue(`1. Open a terminal with root privileges.`));
        console.info(chalk.blue(`2. Use a text editor to open the NGINX configuration file: sudo nano ${path}`));
        console.info(chalk.green(data));
    }
};

/**
 * Executes a shell command and returns a promise that resolves with the command output or rejects with an error.
 * 
 * @param {string} cmd - The command to execute.
 * @returns {Promise<string>} A promise that resolves with the output of the command.
 * @category NetGetX
 * @subcategory Config
 * @module updateNginxConfig
 */
const execShellCommand = (cmd) => {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(error));
            } else {
                resolve(stdout ? stdout : stderr);
            }
        });
    });
};

export default viewNginxConfig;
