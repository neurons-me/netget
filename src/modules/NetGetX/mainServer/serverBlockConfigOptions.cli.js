//netget/src/modules/NetGetX/config/serverBlockConfigOptions.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import setDefaultServerBlock from './setDefaultServerBlock.js';
/**
 * Prompts the user for the server block configuration options.
 * @memberof module:NetGetX.NginxConfiguration
 * @param {object} xConfig The user configuration object.
 * @returns {Promise<boolean>} True if the configuration was successfully restored or the user wants to proceed with the current configuration.
*/

export const serverBlockConfigOptions = async (xConfig) => {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'How would you like to proceed with the server block configuration?',
            choices: [
                'Set/Restore NGINX to Default NetGetX Recommended Settings.',
                'Proceed with Current Configuration',
                'Exit and Adjust Manually'
            ]
        }
    ]);

    switch (answers.action) {
        case 'Set/Restore NGINX to Default NetGetX Recommended Settings.':
            await setDefaultServerBlock(xConfig);
            return true;  // Configuration was successfully restored
        case 'Proceed with Current Configuration':
            console.log(chalk.yellow('Proceeding with existing NGINX configuration.'));
            return true;  // Proceeding with existing configuration is considered successful
        case 'Exit and Adjust Manually':
            console.log(chalk.green('Please adjust your NGINX configuration manually as needed.'));
            process.exit(0);
            return false;  // Exiting for manual adjustment is considered unsuccessful
    }
};
