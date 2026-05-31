//netget/src/modules/utils/handlePermissions.ts
import { exec } from 'child_process';
import fs from 'fs';
import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * Type definition for user action choices
 */
type PermissionAction = 'sudo' | 'manual' | 'changePermissions' | 'cancel';

/**
 * Interface for the action prompt result
 */
interface ActionPromptResult {
    action: PermissionAction;
}

/**
 * Interface for file permission prompt result
 */
interface FilePermissionPromptResult {
    filePath: string;
    requiredPermissions: string;
}

/**
 * Handles permission errors generically.
 * @param taskDescription - Description of the task that requires permission.
 * @param autoCommand - Command to execute for automatic resolution with elevated privileges.
 * @param manualInstructions - Manual instructions for the user to resolve permission issues.
 */
const handlePermission = async (
    taskDescription: string,
    autoCommand: string,
    manualInstructions: string
): Promise<void> => {
    const choices: Array<{ name: string; value: PermissionAction }> = [
        { name: 'Retry with elevated privileges', value: 'sudo' },
        { name: 'Display manual configuration instructions', value: 'manual' },
        { name: 'Try to change file permissions', value: 'changePermissions' },
        { name: 'Cancel operation', value: 'cancel' }
    ];

    console.log(chalk.blue(`\nPrompting user for action: ${taskDescription}`));
    const { action } = await inquirer.prompt<ActionPromptResult>({
        type: 'list',
        name: 'action',
        message: `Permission denied for ${taskDescription}. How would you like to proceed?`,
        choices: choices
    });

    console.log(chalk.blue(`User selected action: ${action}`));

    switch (action) {
        case 'sudo':
            await tryElevatedPrivileges(autoCommand, manualInstructions);
            return;
        case 'manual':
            displayManualInstructions(manualInstructions);
            return;
        case 'changePermissions':
            const { filePath, requiredPermissions } = await inquirer.prompt<FilePermissionPromptResult>([
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
 * @param command - Command to execute with elevated privileges.
 * @param manualInstructions - Instructions for manual permission resolution.
 */
const tryElevatedPrivileges = async (
    command: string,
    manualInstructions: string
): Promise<void> => {
    try {
        console.log(chalk.blue(`\nAttempting to run command with elevated privileges: ${command}`));
        const result = await execShellCommand(`sudo ${command}`);
        console.log(chalk.green('Command executed with elevated privileges.'));
        console.log(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\nFailed with elevated privileges: ${errorMessage}`));
        console.log(chalk.yellow('It is possible that sudo requires a password or cannot be run non-interactively.'));
        console.log(chalk.yellow('Please copy and run the following command manually in your terminal:'));
        console.log(chalk.cyan(`sudo ${command}`));
        displayManualInstructions(manualInstructions);
    }
};

/**
 * Displays manual configuration instructions.
 * @param instructions - Instructions for manual permission resolution.
 */
const displayManualInstructions = (instructions: string): void => {
    console.log(chalk.yellow('To manually configure, follow these instructions:'));
    console.info(chalk.cyan(instructions));
};

/**
 * Executes a shell command.
 * @param cmd - Command to execute.
 * @returns A promise that resolves with the command output.
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

/**
 * Checks and sets file permissions if necessary.
 * @param filePath - Path to the file to check permissions for.
 * @param requiredPermissions - The permissions required (e.g., '755').
 */
const checkAndSetFilePermissions = async (
    filePath: string,
    requiredPermissions: string
): Promise<void> => {
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Failed to check/set permissions for ${filePath}: ${errorMessage}`));
    }
};

export { handlePermission, checkAndSetFilePermissions };
export type { PermissionAction, ActionPromptResult, FilePermissionPromptResult };
