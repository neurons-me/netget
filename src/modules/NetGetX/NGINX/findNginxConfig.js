// findNginxConfig.js
import fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';

/**
 * Finds the NGINX configuration file path.
 * @returns {string|null} - The path to the NGINX configuration file or null if not found.
 * @category NetGetX
 * @subcategory NGINX
 * @module findNginxConfig
 */

const findNginxConfig = () => {
    // Array of potential standard paths for nginx.conf
    const configPaths = [
        '/etc/nginx/nginx.conf',           // Common on Linux
        '/usr/local/etc/nginx/nginx.conf', // Common on Unix/Mac
        '/opt/homebrew/etc/nginx/nginx.conf', // Homebrew on Mac
        'C:\\nginx\\nginx.conf'            // Common on Windows
    ];
    
    // Check if any standard path exists
    const foundPath = configPaths.find(path => fs.existsSync(path));
    if (foundPath) return foundPath;

    // Try to find nginx path in the system PATH
    try {
        const systemPath = execSync('which nginx').toString().trim();
        // Extract the config file path using nginx -t
        const configTestCmd = `${systemPath} -t`;
        const output = execSync(configTestCmd).toString();
        const match = output.match(/nginx: configuration file (\S*) syntax is ok/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (error) {
        console.error(chalk.red(`Failed to locate NGINX via system PATH: ${error.message}`));
    }
    
    return null;
};

export default findNginxConfig;
