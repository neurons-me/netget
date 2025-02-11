import inquirer from 'inquirer';
import chalk from 'chalk';
import mainServerMenu from './mainServer/mainServer.cli.js';
import displayStateAndConfig from './config/x_StateAndConfig.js';

/**
 * This function displays the NetGetX settings menu
 * @memberof module:NetGetX
 * @param {Object} x - The NetGetX instance
 * @returns {Promise<void>} - A promise that resolves when the menu is displayed 
 */
const netGetXSettingsMenu = async (x) => {
    const options = [
        { name: 'Main Server Configuration', value: 'Main Server' },
        { name: 'xConfig/xState', value: 'xConfig/xState' },
        { name: 'About NetGetX', value: 'aboutNetGetX' },
        { name: 'Back to Main Menu', value: 'mainMenu' }
    ];

    const answer = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Select an action:',
            choices: options
        }
    ]);

    switch (answer.action) {
        case 'Main Server':
            await mainServerMenu(x);
            break;

        case 'xConfig/xState':
            await displayStateAndConfig(x); // Call the function to display the state and config
            break;

        case 'aboutNetGetX':
            console.log(chalk.green('About NetGetX'));
            console.log(chalk.blue('NetGetX is a powerful tool for managing servers, network configurations, domains and SSL setups.'));
            console.log(chalk.blue('Developed by: neurons.me'));
            console.log(chalk.blue('For more information, visit the official documentation.'));
            break;
        case 'mainMenu':
            console.log(chalk.green('Returning to the main menu...'));
            // Call the main menu function here if it exists
            break;
        default:
            console.log(chalk.red('Invalid selection. Please try again.'));
            await netGetXSettingsMenu(x);
    }
};

export default netGetXSettingsMenu;



