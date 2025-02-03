//netget/src/modules/utils/handlePermissions.js
import { exec } from 'child_process';
import fs from 'fs';
import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * Handles permission errors generically.
 * @param {string} taskDescription - Description of the task that requires permission.
 * @param {string} autoCommand - Command to execute for automatic resolution with elevated privileges.
 * @param {string} manualInstructions - Manual instructions for the user to resolve permission issues.
 */
const handlePermission = async (taskDescription, autoCommand, manualInstructions) => {
    const choices = [
        { name: 'Retry with elevated privileges', value: 'sudo' },
        { name: 'Display manual configuration instructions', value: 'manual' },
        { name: 'Try to change file permissions', value: 'changePermissions' },
        { name: 'Cancel operation', value: 'cancel' }
    ];

    console.log(chalk.blue(`Prompting user for action: ${taskDescription}`));
    const { action } = await inquirer.prompt({
        type: 'list',
        name: 'action',
        message: `Permission denied for ${taskDescription}. How would you like to proceed?`,
        choices: choices
    });

    console.log(chalk.blue(`User selected action: ${action}`));

    switch (action) {
        case 'sudo':
            await tryElevatedPrivileges(autoCommand, manualInstructions);
            break;
        case 'manual':
            displayManualInstructions(manualInstructions);
            break;
        case 'changePermissions':
            const { filePath, requiredPermissions } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'filePath',
                    message: 'Enter the path of the file to change permissions:'
                },
                {
                    type: 'input',
                    name: 'requiredPermissions',
                    message: 'Enter the required permissions (e.g., 755) [default: 755]:',
                    default: '755'
                }
            ]);
            if (requiredPermissions) {
                await checkAndSetFilePermissions(filePath, requiredPermissions);
            } else {
                console.log(chalk.red('Permissions value is required.'));
            }
            break;
        case 'cancel':
            console.log(chalk.blue('Operation canceled by the user.'));
            break;
    }
};

/**
 * Tries to execute a command with elevated privileges.
 * @param {string} command - Command to execute with elevated privileges.
 * @param {string} manualInstructions - Instructions for manual permission resolution.
 */
const tryElevatedPrivileges = async (command, manualInstructions) => {
    try {
        console.log(chalk.blue(`Attempting to run command with elevated privileges: ${command}`));
        const result = await execShellCommand(`sudo ${command}`);
        console.log(chalk.green('Command executed with elevated privileges.'));
        console.log(result);
    } catch (error) {
        console.error(chalk.red(`Failed with elevated privileges: ${error.message}`));
        displayManualInstructions(manualInstructions);
    }
};

/**
 * Displays manual configuration instructions.
 * @param {string} instructions - Instructions for manual permission resolution.
 */
const displayManualInstructions = (instructions) => {
    console.log(chalk.yellow('To manually configure, follow these instructions:'));
    console.info(chalk.cyan(instructions));
};

/**
 * Executes a shell command.
 * @param {string} cmd - Command to execute.
 * @returns {Promise<string>} - A promise that resolves with the command output.
 */
const execShellCommand = (cmd) => {
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

/**
 * Checks and sets file permissions if necessary.
 * @param {string} filePath - Path to the file to check permissions for.
 * @param {string} requiredPermissions - The permissions required (e.g., '755').
 */
const checkAndSetFilePermissions = async (filePath, requiredPermissions) => {
    try {
        const stats = fs.statSync(filePath);
        const currentPermissions = `0${(stats.mode & 0o777).toString(8)}`;
        
        if (currentPermissions !== requiredPermissions) {
            await execShellCommand(`sudo chmod ${requiredPermissions} ${filePath}`);
            console.log(chalk.green(`Permissions for ${filePath} set to ${requiredPermissions}.`));
        } else {
            console.log(chalk.green(`Permissions for ${filePath} are already set to ${requiredPermissions}.`));
        }
    } catch (error) {
        console.error(chalk.red(`Failed to check/set permissions for ${filePath}: ${error.message}`));
    }
};

export { handlePermission, checkAndSetFilePermissions };
