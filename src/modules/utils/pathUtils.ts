// pathUtils.ts
import fs from 'fs';
import chalk from 'chalk';
import { handlePermission } from './handlePermissions.ts';

/**
 * Checks and corrects permissions of a directory.
 * @param {string} dirPath - Path of the directory to check.
 * @param {number} desiredMode - Desired permission mode (e.g., 0o755).
 */
const checkPermissions = (dirPath: string, desiredMode: number): void => {
    const stats = fs.statSync(dirPath);
    if ((stats.mode & 0o777) !== desiredMode) {
        fs.chmodSync(dirPath, desiredMode);
    }
};

/**
 * Function to ensure the directory exists and has the correct permissions.
 * @param {string} directory - The directory path to check or create.
 * @param {number} [desiredMode=0o757] - The desired permission mode to set if the directory is created or permissions are incorrect.
*/
async function ensureDirectoryExists(directory: string, desiredMode: number = 0o757): Promise<void> {
    try {
        let directoryExists = fs.existsSync(directory);
        if (!directoryExists) {
            fs.mkdirSync(directory, { recursive: true });
            console.log(chalk.green(`Directory created: ${directory}`));
        } else {
            // console.log(chalk.blue(`Directory already exists: ${directory}`));
        }
        // Check and set permissions whether the directory was just created or already existed
        checkPermissions(directory, desiredMode);
    } catch (error: any) {
        if (error.code === 'EACCES') {
            console.error(chalk.red(`Permission denied to create or modify directory at ${directory}.`));
            await handlePermission(
                `creating or modifying directory at ${directory}`,
                `sudo mkdir -p ${directory} && sudo chmod ${desiredMode.toString(8)} ${directory}`,
                `sudo mkdir -p ${directory} && sudo chmod ${desiredMode.toString(8)} ${directory}`
            );
            throw new Error(`PermissionError: ${error.message}`);
        } else {
            console.error(chalk.red(`An error occurred while trying to ensure directory exists at ${directory}: ${error.message}`));
        }
    }
}

/**
 * Checks if a specified path (directory or file) exists.
 * @param {string} path - The path to check.
 * @returns {boolean} - True if the path exists, false otherwise.
*/
function pathExists(path: string): boolean {
    return fs.existsSync(path);
}

// Export both functions explicitly
export { ensureDirectoryExists, pathExists, checkPermissions };
