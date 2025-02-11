import { exec } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import os from 'os';
/**
 * Handles permission errors when creating directories.
 * @param {string} directory - The directory path where permission was denied.
*/
const handlePermissionErrorForEnsureDir = async (directory) => {
    const choices = [
        { name: 'Retry with elevated privileges', value: 'sudo' },
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
            await tryElevatedPrivileges(directory);
            break;
        case 'manual':
            displayManualInstructions(directory);
            break;
        case 'cancel':
            console.log(chalk.blue('Operation canceled by the user.'));
            break;
    }
};

/**
 * Tries to create the directory with elevated privileges.
 * @param {string} directory - The directory path to create.
*/

const tryElevatedPrivileges = async (directory) => {
    let command;
    if (os.platform() === 'win32') {
        command = `powershell -Command "New-Item -ItemType Directory -Force -Path ${directory}; Set-ACL -Path ${directory} -AclObject (Get-Acl -Path ${directory})"`;
    } else {
        command = `sudo mkdir -p ${directory} && sudo chmod 755 ${directory}`;
    }

    try {
        await execShellCommand(command);
        console.log(chalk.green('Directory permissions adjusted with elevated privileges.'));
    } catch (error) {
        console.error(chalk.red(`Failed with elevated privileges: ${error.message}`));
        displayManualInstructions(directory);
    }
};

/**
 * Displays manual configuration instructions for setting directory permissions.
 * @param {string} directory - The directory path to display instructions for.
*/

const displayManualInstructions = (directory) => {
    if (os.platform() === 'win32') {
        console.log(chalk.yellow(`To manually configure on Windows, run the following commands with administrator privileges:`));
        console.info(chalk.cyan(`powershell -Command "New-Item -ItemType Directory -Force -Path ${directory}"`));
        console.info(chalk.cyan(`powershell -Command "Set-ACL -Path ${directory} -AclObject (Get-Acl -Path ${directory})"`));
    } else {
        console.log(chalk.yellow(`To manually configure on Unix/Linux, run the following command with elevated privileges:`));
        console.info(chalk.cyan(`sudo mkdir -p ${directory} && sudo chmod 755 ${directory}`));
    }
}

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

export default handlePermissionErrorForEnsureDir;
