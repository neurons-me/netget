//netget/src/modules/NetGetX/Domains/SSL/Certbot/checkAndInstallCertbot.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

/**
 * Check if Certbot and Certbot NGINX plugin are installed, and install them if necessary.
 * @returns Promise resolving to true if Certbot and its NGINX plugin are installed, false otherwise.
 * @memberof module:NetGetX.SSL.SSL
 */
const checkAndInstallCertbot = async (): Promise<boolean> => {
    try {
        await execAsync('certbot --version');
        console.log(chalk.green('Certbot is already installed.'));
        return await checkCertbotNginxPlugin();
    } catch (error) {
        console.log(chalk.yellow('Certbot is not installed. Installing Certbot...'));
        return await installCertbot();
    }
};

/**
 * Install Certbot.
 * @memberof module:NetGetX.SSL
 * @returns Promise resolving to true if Certbot is installed successfully, false otherwise.
 */
const installCertbot = async (): Promise<boolean> => {
    try {
        console.log(chalk.blue('Installing Certbot...'));
        console.log(chalk.blue('Running: sudo apt-get install -y certbot'));
        
        const { stdout, stderr } = await execAsync('sudo apt-get install -y certbot');
        
        if (stderr && !stderr.includes('Reading')) {
            console.warn(chalk.yellow(`Installation warnings: ${stderr}`));
        }
        
        console.log(chalk.green('Certbot installed successfully.'));
        return await checkCertbotNginxPlugin();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Failed to install Certbot: ${errorMessage}`));
        throw new Error(`Certbot installation failed: ${errorMessage}`);
    }
};

/**
 * Check if Certbot NGINX plugin is installed, and install it if necessary.
 * @memberof module:NetGetX.SSL
 * @returns Promise resolving to true if Certbot NGINX plugin is installed, false otherwise.
 */
const checkCertbotNginxPlugin = async (): Promise<boolean> => {
    try {
        const { stdout } = await execAsync('certbot plugins');
        
        if (!stdout.includes('nginx')) {
            console.log(chalk.yellow('Certbot NGINX plugin is not installed. Installing plugin...'));
            return await installCertbotNginxPlugin();
        }
        
        console.log(chalk.green('Certbot NGINX plugin is already installed.'));
        return true;
    } catch (error) {
        console.log(chalk.yellow('Could not check Certbot plugins. Installing NGINX plugin...'));
        return await installCertbotNginxPlugin();
    }
};

/**
 * Install Certbot NGINX plugin.
 * @memberof module:NetGetX.SSL
 * @returns Promise resolving to true if Certbot NGINX plugin is installed successfully, false otherwise.
 */
const installCertbotNginxPlugin = async (): Promise<boolean> => {
    try {
        console.log(chalk.blue('Installing Certbot NGINX plugin...'));
        console.log(chalk.blue('Running: sudo apt-get install -y python3-certbot-nginx'));
        
        const { stdout, stderr } = await execAsync('sudo apt-get install -y python3-certbot-nginx');
        
        if (stderr && !stderr.includes('Reading')) {
            console.warn(chalk.yellow(`Installation warnings: ${stderr}`));
        }
        
        console.log(chalk.green('Certbot NGINX plugin installed successfully.'));
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Failed to install Certbot NGINX plugin: ${errorMessage}`));
        throw new Error(`Certbot NGINX plugin installation failed: ${errorMessage}`);
    }
};

export default checkAndInstallCertbot;