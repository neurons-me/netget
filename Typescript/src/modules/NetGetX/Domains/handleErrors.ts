import chalk from 'chalk';
import inquirer from 'inquirer';
import { exec } from 'child_process';
import os from 'os';

// Interface for inquirer choices
interface ActionChoice {
    name: string;
    value: 'sudo' | 'manual' | 'cancel';
}

// Interface for inquirer prompt answers
interface ActionAnswers {
    action: 'sudo' | 'manual' | 'cancel';
}

/**
 * Handles permission errors by offering options to retry with elevated privileges,
 * display manual configuration instructions, or cancel the operation.
 * @memberof module:NetGetX.Utils
 * @param path - The filesystem path where permission was denied.
 * @param data - Data intended to be written to the path.
 */
const handlePermissionError = async (path: string, data: string): Promise<void> => {
    const isWindows: boolean = os.platform() === 'win32';
    const choices: ActionChoice[] = [
        { name: `Retry with elevated privileges ${isWindows ? '(Run as Administrator)' : '(sudo)'}`, value: 'sudo' },
        { name: 'Display manual configuration instructions', value: 'manual' },
        { name: 'Cancel operation', value: 'cancel' }
    ];

    const { action }: ActionAnswers = await inquirer.prompt({
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
 * @memberof module:NetGetX.Utils
 * @param path - The filesystem path where the operation should be performed.
 * @param data - Data to be written or processed.
 * @param isWindows - Flag indicating if the operating system is Windows.
 */
const tryElevatedPrivileges = async (path: string, data: string, isWindows: boolean): Promise<void> => {
    const command: string = isWindows 
        ? `powershell -Command "Start-Process PowerShell -ArgumentList 'Set-Content -Path ${path} -Value ${escapeDataForShell(data)}' -Verb RunAs"`
        : `echo '${escapeDataForShell(data)}' | sudo tee ${path}`;

    try {
        await execShellCommand(command);
        console.log(chalk.green('Successfully updated NGINX configuration with elevated privileges.'));
    } catch (error: any) {
        console.error(chalk.red(`Failed with elevated privileges: ${error.message}`));
        displayManualInstructions(path, data, isWindows);
    }
};

/**
 * Escapes shell-specific characters in a string to safely include it in a shell command.
 * @memberof module:NetGetX.Utils
 * @param data - The data to escape.
 * @returns The escaped data.
 */
const escapeDataForShell = (data: string): string => {
    return data.replace(/'/g, "'\\''");
};

/**
 * Displays manual instructions for configuring NGINX in case of permission errors or user preference.
 * @memberof module:NetGetX.Utils
 * @param path - The filesystem path related to the instructions.
 * @param data - The data or configuration details to be manually applied.
 * @param isWindows - Flag indicating if the operating system is Windows.
 */
const displayManualInstructions = (path: string, data: string, isWindows: boolean): void => {
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
 * @memberof module:NetGetX.Utils
 * @param cmd - The command to execute.
 * @returns A promise that resolves with the output of the command.
 */
const execShellCommand = (cmd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(error.message));
            } else {
                resolve(stdout ? stdout : stderr);
            }
        });
    });
};

export { handlePermissionError, tryElevatedPrivileges, escapeDataForShell, displayManualInstructions, execShellCommand };