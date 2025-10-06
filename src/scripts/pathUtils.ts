//netget/src/scripts/pathUtils.ts
import * as fs from 'fs';
import chalk from 'chalk';

/**
 * Checks and corrects permissions of a directory.
 * @param dirPath - Path of the directory to check.
 * @param desiredMode - Desired permission mode (e.g., 0o755).
 */
const checkPermissions = (dirPath: string, desiredMode: number): void => {
    const stats = fs.statSync(dirPath);
    if ((stats.mode & 0o777) !== desiredMode) {
        fs.chmodSync(dirPath, desiredMode);
    }
};

/**
 * Function to ensure the directory exists and has the correct permissions.
 * @param directory - The directory path to check or create.
 * @param desiredMode - The desired permission mode to set if the directory is created or permissions are incorrect.
 * @category Utils
 * @subcategory General
 * @module pathUtils
*/
function ensureDirectoryExists(directory: string, desiredMode: number = 0o755): void {
    try {
        const directoryExists: boolean = fs.existsSync(directory);
        if (!directoryExists) {
            fs.mkdirSync(directory, { recursive: true });
            console.log(chalk.green(`Directory created: ${directory}`));
        } else {
            //console.log(chalk.blue(`Directory already exists: ${directory}`));
        }
        // Check and set permissions whether the directory was just created or already existed
        checkPermissions(directory, desiredMode);
    } catch (error: any) {
        if (error.code === 'EACCES') {
            console.error(chalk.red(`Permission denied to create or modify directory at ${directory}.`));
            console.error(chalk.yellow(`To resolve this, you can run the following command with administrator privileges:`));
            console.info(chalk.cyan(`sudo mkdir -p ${directory} && sudo chmod ${desiredMode.toString(8)} ${directory}`));
            throw new Error(`PermissionError: ${error.message}`);
        } else {
            console.error(chalk.red(`An error occurred while trying to ensure directory exists at ${directory}: ${error.message}`));
        }
    }
}

/**
 * Checks if a specified path (directory or file) exists.
 * @param path - The path to check.
 * @returns True if the path exists, false otherwise.
 * @category Utils
 * @subcategory General
 * @module pathUtils
*/
function pathExists(path: string): boolean {
    return fs.existsSync(path);
}

// Export both functions explicitly
export { ensureDirectoryExists, pathExists, checkPermissions };