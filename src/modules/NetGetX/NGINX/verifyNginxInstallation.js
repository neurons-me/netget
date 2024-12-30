import { execSync } from 'child_process';
import fs from 'fs';
import chalk from 'chalk';
/**
 * Verifies the installation of NGINX on the system.
 * @returns {string|null} - The path to the NGINX executable or null if not found.
 * @example
 * const nginxPath = verifyNginxInstallation();
 * if (nginxPath) {
 *  console.log(`NGINX found at: ${nginxPath}`);
 * } else {
 * console.log('NGINX not found on system PATH or common locations.');
 * }
 * @see {@link https://nginx.org/|NGINX}
 * @category NetGetX
 * @subcategory NGINX
 * @module verifyNginxInstallation
 * */

async function verifyNginxInstallation() {
    const nginxPaths = [
        '/usr/sbin/nginx',
        '/usr/local/nginx/sbin/nginx',
        '/usr/local/sbin/nginx',
        '/usr/local/bin/nginx',
        '/sbin/nginx',
        '/opt/nginx/sbin/nginx',
        '/opt/homebrew/bin/nginx', // Homebrew managed nginx on newer macOS
        'C:\\Program Files\\nginx\\nginx.exe',
        'C:\\nginx\\nginx.exe'
    ];

    // First, try to detect using 'which' or 'where' based on the platform
    try {
        const command = process.platform === 'win32' ? 'where' : 'which';
        const result = execSync(`${command} nginx`).toString().trim();
        if (result) {
            //console.log(chalk.green(`NGINX executable at: ${result}`));
            return result;
        }
    } catch (error) {
        // Delay warning until after all paths have been checked
    }

    // If 'which' or 'where' fails, check common paths directly
    for (let nginxPath of nginxPaths) {
        if (fs.existsSync(nginxPath)) {
            //console.log(chalk.green(`NGINX executable at: ${nginxPath}`));
            return nginxPath;
        }
    }
    console.warn(chalk.yellow(`NGINX not found on system PATH or any common locations.`));
    return null;
}

export default verifyNginxInstallation;
