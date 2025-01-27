import { execSync } from 'child_process';
import chalk from 'chalk';
/**
 * Verifies if OpenResty is installed by checking the version.
 * @returns {boolean} True if OpenResty is installed, false otherwise.
 */
export default async function verifyOpenRestyInstallation() {
    try {
        await printOpenRestyVersion();
        return true;
    } catch (error) {
        console.error('OpenResty is not installed. We validate the installation by checking the version.');
        console.error('Please install OpenResty and try again.');
        return false;
    }
}

async function printOpenRestyVersion() {
    const openRestyCommand = 'openresty -v 2>&1'; // Redirect stderr to stdout
    const version = execSync(openRestyCommand).toString();
    console.log(`Open Resty version: ${chalk.blue(version)}`);
}

