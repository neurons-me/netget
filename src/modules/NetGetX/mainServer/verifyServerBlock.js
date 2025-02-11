//netget/src/modules/mainServer/verifyServerBlock.js
import fs from 'fs';
import chalk from 'chalk';
import getDefaultServerBlock from './xDefaultServerBlock.js';
import { serverBlockConfigOptions } from './serverBlockConfigOptions.cli.js';

/**
 * Verifies if the existing NGINX server block matches the expected configuration.
 * If not, it may prompt the user to update the configuration depending on the user's settings.
 * @memberof module:NetGetX.NginxConfiguration
 * @param {Object} xConfig - The configuration object containing the path to the NGINX config file and user preferences.
 * @returns {Promise<boolean>} True if the current configuration is correct or successfully updated; false if it fails.
 */
const verifyServerBlock = async (xConfig) => {
    const nginxConfigPath = xConfig.nginxPath;
    const expectedServerBlock = getDefaultServerBlock(xConfig);
    
    try {
        const configData = fs.readFileSync(nginxConfigPath, 'utf8');

        const normalizeWhitespace = (str) => str.replace(/\s+/g, ' ').trim();
        const normalizedExpectedBlock = normalizeWhitespace(expectedServerBlock);
        const normalizedConfigData = normalizeWhitespace(configData);

        if (normalizedConfigData.includes(normalizedExpectedBlock)) {
            return true;
        } else {
            console.log(chalk.yellow('Default NGINX server block does not match the expected default setup.'));
            if (xConfig.nginxConfigurationProceed) {
                console.log(chalk.green('Proceeding with existing configuration as per user preference.'));
                return true;
            } else {
                const configurationSuccess = await serverBlockConfigOptions(xConfig);
                return configurationSuccess;
            }
        }
    } catch (error) {
        console.error(chalk.red(`Failed to read NGINX configuration from ${nginxConfigPath}: ${error.message}`));
        console.log(chalk.yellow('Please clean your userConfig.json values and try again...'));
        return false;
    }
};

export default verifyServerBlock;
