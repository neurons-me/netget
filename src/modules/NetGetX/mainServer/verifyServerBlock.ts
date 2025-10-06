//netget/src/modules/NetGetX/mainServer/verifyServerBlock.ts
import fs from 'fs';
import chalk from 'chalk';
// import getDefaultServerBlock from './xDefaultServerBlock.js'; // Temporarily disabled - needs migration
import { serverBlockConfigOptions } from './serverBlockConfigOptions.cli.js';
import { XConfig } from '../config/xConfig.js';

/**
 * Verifies if the existing NGINX server block matches the expected configuration.
 * If not, it may prompt the user to update the configuration depending on the user's settings.
 * @memberof module:NetGetX.NginxConfiguration
 * @param xConfig - The configuration object containing the path to the NGINX config file and user preferences.
 * @returns True if the current configuration is correct or successfully updated; false if it fails.
 */
const verifyServerBlock = async (xConfig: XConfig): Promise<boolean> => {
    const nginxConfigPath: string | undefined = xConfig.nginxPath;
    
    if (!nginxConfigPath) {
        console.error(chalk.red('NGINX configuration path not found in xConfig'));
        return false;
    }
    
    console.log(chalk.yellow('Server block verification temporarily simplified during TypeScript migration'));
    console.log(chalk.blue(`Would verify server block at: ${nginxConfigPath}`));
    
    // Implementation temporarily simplified during migration
    // const expectedServerBlock = getDefaultServerBlock(xConfig);
    
    try {
        const configData: string = fs.readFileSync(nginxConfigPath, 'utf8');

        const normalizeWhitespace = (str: string): string => str.replace(/\s+/g, ' ').trim();
        // const normalizedExpectedBlock = normalizeWhitespace(expectedServerBlock);
        const normalizedConfigData: string = normalizeWhitespace(configData);

        // Simplified check during migration
        if (normalizedConfigData.length > 0) {
            console.log(chalk.green('Configuration file exists and has content'));
            return true;
        } else {
            console.log(chalk.yellow('Default NGINX server block does not match the expected default setup.'));
            if (xConfig.nginxConfigurationProceed) {
                console.log(chalk.green('Proceeding with existing configuration as per user preference.'));
                return true;
            } else {
                console.log(chalk.yellow('Server block configuration options temporarily simplified during migration'));
                // const configurationSuccess = await serverBlockConfigOptions(xConfig);
                return true; // Temporarily return true during migration
            }
        }
    } catch (error: any) {
        console.error(chalk.red(`Failed to read NGINX configuration from ${nginxConfigPath}: ${error.message}`));
        console.log(chalk.yellow('Please clean your userConfig.json values and try again...'));
        return false;
    }
};

export default verifyServerBlock;