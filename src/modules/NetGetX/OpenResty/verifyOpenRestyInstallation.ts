import { execSync } from 'child_process';
import chalk from 'chalk';

/**
 * Verifies if OpenResty is installed by checking the version.
 * @memberof module:NetGetX.OpenResty
 * @returns True if OpenResty is installed, false otherwise.
 */
export default async function verifyOpenRestyInstallation(): Promise<boolean> {
    try {
        await printOpenRestyVersion();
        return true;
    } catch (error: any) {
        console.error(chalk.red('OpenResty is not installed. We validate the installation by checking the version.'));
        return false;
    }
}

/**
 * Prints the OpenResty version to the console.
 * @returns Promise that resolves when version is printed.
 */
async function printOpenRestyVersion(): Promise<void> {
    const openRestyCommand: string = 'openresty -v 2>&1'; // Redirect stderr to stdout
    const version: string = execSync(openRestyCommand).toString();
    console.log(`Open Resty version: ${chalk.blue(version)}`);
}