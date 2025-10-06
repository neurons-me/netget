//netget/src/modules/NetGetX/mainServer/serverBlockConfigOptions.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { setDefaultServerBlock } from './setDefaultServerBlock.js';
import { XConfig } from '../config/xConfig.js';

// Interface for configuration options
interface ConfigOption {
    name?: string;
    value?: string;
}

// Interface for prompt answers
interface ConfigAnswers {
    action: string;
}

/**
 * Prompts the user for the server block configuration options.
 * @memberof module:NetGetX.NginxConfiguration
 * @param xConfig The user configuration object.
 * @returns True if the configuration was successfully restored or the user wants to proceed with the current configuration.
 */
export const serverBlockConfigOptions = async (xConfig: XConfig): Promise<boolean> => {
    const choices: Array<string> = [
        'Set/Restore NGINX to Default NetGetX Recommended Settings.',
        'Proceed with Current Configuration',
        'Exit and Adjust Manually'
    ];

    const answers: ConfigAnswers = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'How would you like to proceed with the server block configuration?',
            choices: choices
        }
    ]);

    switch (answers.action) {
        case 'Set/Restore NGINX to Default NetGetX Recommended Settings.':
            await setDefaultServerBlock(xConfig);
            return true;  // Configuration was successfully restored
        case 'Proceed with Current Configuration':
            console.log(chalk.yellow('Proceeding with existing NGINX configuration.'));
            return true;  // User chose to proceed with current configuration
        case 'Exit and Adjust Manually':
            console.log(chalk.blue('Exiting to allow manual configuration adjustments.'));
            return false; // User chose to exit and adjust manually
        default:
            console.log(chalk.red('Invalid selection. Defaulting to proceed with current configuration.'));
            return true;
    }
};