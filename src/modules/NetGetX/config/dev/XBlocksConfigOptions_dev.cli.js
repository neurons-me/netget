//netget/src/modules/NetGetX/config/serverBlockConfigOptions.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import setDefaultServerBlock_dev from './setDefaultServerBlock_dev.js';

export const XBlocksConfigOptions_dev = async (userConfig) => {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'How would you like to proceed with the Development server block configuration?',
            choices: [
                'Set/Restore NGINX to Default NetGetX Development Recommended Settings.',
                'Proceed with Current Configuration',
                'Exit and Adjust Manually'
            ]
        }
    ]);

    switch (answers.action) {
        case 'Set/Restore NGINX to Default NetGetX Development Recommended Settings.':
            await setDefaultServerBlock_dev(userConfig);
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