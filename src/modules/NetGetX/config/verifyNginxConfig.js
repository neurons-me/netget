// verifyNginxConfig.js
import fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';

/**
 * Verifies the NGINX config
 * and executable paths set in the configuration object.
 * Checks if the NGINX configuration path and executable exist and tries to execute NGINX to ensure it's operational.
 *
 * @param {Object} xConfig - The configuration object containing paths and settings for NGINX.
 * @returns {Promise<boolean>} - Returns true if NGINX is properly configured and executable, otherwise returns false.
 * @category NetGetX
 * @subcategory Config
 * @module verifyNginxConfig
 */
export default async function verifyNginxConfig(xConfig) {
    // Verify if all required paths are set and exist
    if (!xConfig.nginxPath || !fs.existsSync(xConfig.nginxPath)) {
        console.log(chalk.red('NGINX configuration path is not set or does not exist.'));
        return false;
    }

    // Verify if NGINX executable can be run to check its version
    if (!xConfig.nginxExecutable || !fs.existsSync(xConfig.nginxExecutable)) {
        console.log(chalk.red('NGINX executable path is not set or does not exist.'));
        return false;
    }

    try {
        const nginxVersionCommand = `${xConfig.nginxExecutable} -v 2>&1`; // Redirect stderr to stdout
        const output = execSync(nginxVersionCommand).toString();
        console.log(`${chalk.blue(output)}`);
    } catch (error) {
        console.log(chalk.red(`Failed to execute NGINX: ${error.message}`));
        return false;
    }
    return true;
}