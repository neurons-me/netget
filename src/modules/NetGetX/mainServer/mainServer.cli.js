import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.js';

/**
 * Menu for managing the Main Server configuration.
 * @memberof module:NetGetX
 * @param {Object} x - The user configuration object.
 */
async function mainServerMenu(x) {
    console.log(chalk.blue('Displaying current main server configuration...'));
    console.log(chalk.blue('Static Path:', x.static));
    
    const mainDomain = x.mainServerName;
    if (!mainDomain) {
        console.log(chalk.blue('No available domains.'));
    } else {
        console.log(chalk.blue('Main Domain:', x.mainServerName));
    }
    let back = false;
    while (!back) {
        const mainServerMenuOptions = [
            { name: 'Edit Main Server Name', value: 'editMainServer' },
            { name: 'Back', value: 'back' }
        ];
        const { mainServerMenuAction } = await inquirer.prompt([
            {
                type: 'list',
                name: 'mainServerMenuAction',
                message: chalk.cyan('Main Server Configuration:'),
                choices: mainServerMenuOptions
            }
        ]);
        switch (mainServerMenuAction) {
            case 'editMainServer':
                let editBack = false;
                while (!editBack) {
                    const { newMainServer } = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'newMainServer',
                            message: chalk.yellow('Enter new main server name (or type /b to return):'),
                            validate: input => input ? true : 'Server name cannot be empty.'
                        }
                    ]);
                    if (newMainServer.trim() === '/b') {
                        editBack = true;
                        break;
                    }
                    // Save to xConfig
                    try {
                        await saveXConfig({ mainServerName: newMainServer });
                        const updatedConfig = await loadOrCreateXConfig();
                        Object.assign(x, updatedConfig); // update x in place
                        console.log(chalk.green(`Main server updated to: ${newMainServer}`));
                        editBack = true;
                    } catch (err) {
                        console.log(chalk.red('Failed to update main server name:', err));
                    }
                }
                break;
            case 'back':
                back = true;
                break;
        }
    }
}

export default mainServerMenu;
