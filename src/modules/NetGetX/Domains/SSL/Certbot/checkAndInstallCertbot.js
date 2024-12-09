//netget/src/modules/NetGetX/SSL/Certbot/checkAndInstallCertbot.js
import { exec } from 'child_process';
import chalk from 'chalk';

/**
 * Check if Certbot and Certbot NGINX plugin are installed, and install them if necessary.
 * @returns {Promise<boolean>} Promise resolving to true if Certbot and its NGINX plugin are installed, false otherwise.
 * @category NetGetX
 * @subcategory SSL 
*/
const checkAndInstallCertbot = () => {
    return new Promise((resolve, reject) => {
        exec('certbot --version', (error, stdout, stderr) => {
            if (error) {
                console.log(chalk.yellow('Certbot is not installed. Installing Certbot...'));
                installCertbot().then(resolve).catch(reject);
            } else {
                console.log(chalk.green('Certbot is already installed.'));
                checkCertbotNginxPlugin().then(resolve).catch(reject);
            }
        });
    });
};

/**
 * Install Certbot.
 * @category NetGetX
 * @subcategory SSL
 * @subcategory Certbot
 * @returns {Promise<boolean>} Promise resolving to true if Certbot is installed successfully, false otherwise.
 */
const installCertbot = () => {
    return new Promise((resolve, reject) => {
        exec('sudo apt-get install -y certbot', (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to install Certbot: ${error.message}`));
                reject(false);
                return;
            }
            console.log(chalk.green('Certbot installed successfully.'));
            checkCertbotNginxPlugin().then(resolve).catch(reject);
        });
    });
};

/**
 * Check if Certbot NGINX plugin is installed, and install it if necessary.
 * @returns {Promise<boolean>} Promise resolving to true if Certbot NGINX plugin is installed, false otherwise.
 * @category NetGetX
 * @subcategory SSL
 */
const checkCertbotNginxPlugin = () => {
    return new Promise((resolve, reject) => {
        exec('certbot plugins', (error, stdout, stderr) => {
            if (error || !stdout.includes('nginx')) {
                console.log(chalk.yellow('Certbot NGINX plugin is not installed. Installing plugin...'));
                installCertbotNginxPlugin().then(resolve).catch(reject);
            } else {
                console.log(chalk.green('Certbot NGINX plugin is already installed.'));
                resolve(true);
            }
        });
    });
};

/**
 * Install Certbot NGINX plugin.
 * @category NetGetX
 * @subcategory SSL
 * @subcategory Certbot
 * @returns {Promise<boolean>} Promise resolving to true if Certbot NGINX plugin is installed successfully, false otherwise.
 */
const installCertbotNginxPlugin = () => {
    return new Promise((resolve, reject) => {
        exec('sudo apt-get install -y python3-certbot-nginx', (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to install Certbot NGINX plugin: ${error.message}`));
                reject(false);
                return;
            }
            console.log(chalk.green('Certbot NGINX plugin installed successfully.'));
            resolve(true);
        });
    });
};

export default checkAndInstallCertbot;
