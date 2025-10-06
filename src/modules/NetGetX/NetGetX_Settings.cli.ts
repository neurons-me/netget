import inquirer from 'inquirer';
import chalk from 'chalk';
import { XStateData } from './xState.ts';
import mainServerMenu from './mainServer/mainServer.cli.ts';
import displayStateAndConfig from './config/x_StateAndConfig.ts';

interface SettingsMenuAnswers {
    action: string;
}

interface MainServerAnswers {
    newMainServer: string;
}

interface MenuOption {
    name: string;
    value: string;
}

/**
 * This function displays the NetGetX settings menu
 * @memberof module:NetGetX
 * @param x - The NetGetX instance
 * @returns A promise that resolves when the menu is displayed 
 */
const netGetXSettingsMenu = async (x: XStateData): Promise<void> => {
    const mainServerSet: boolean = !!(x.mainServerName && typeof x.mainServerName === 'string' && x.mainServerName.trim() !== '');
    const options: MenuOption[] = [
        { name: 'Main Server Configuration', value: 'Main Server' },
        { name: 'xConfig/xState', value: 'xConfig/xState' },
        { name: 'About NetGetX', value: 'aboutNetGetX' },
        { name: 'Back to Main Menu', value: 'mainMenu' }
    ];

    // Show instructions if main server is not set
    if (!mainServerSet) {
        console.log(chalk.red('Main server is not set!') + ' ' + chalk.yellow(' Please use "Edit Main Server Name" to set it before accessing Local.Netget.'));
        console.log(chalk.gray('Local.Netget option will remain locked until you set the main server.'));
    } else {
        console.log(chalk.green('Main server is set: ') + chalk.cyan(x.mainServerName));
    }

    const answer = await inquirer.prompt<SettingsMenuAnswers>([
        {
            type: 'list',
            name: 'action',
            message: chalk.bold('Select an action:'),
            choices: options
        }
    ]);

    switch (answer.action) {
        case 'Main Server':
            await mainServerMenu(x);
            break;

        case 'EditMainServer':
            const { newMainServer } = await inquirer.prompt<MainServerAnswers>([
                {
                    type: 'input',
                    name: 'newMainServer',
                    message: 'Enter new main server name:',
                    validate: (input: string) => input ? true : 'Server name cannot be empty.'
                }
            ]);
            // Save to xConfig
            try {
                const { saveXConfig, loadOrCreateXConfig } = await import('./config/xConfig.ts');
                await saveXConfig({ mainServerName: newMainServer });
                const updatedConfig = await loadOrCreateXConfig();
                Object.assign(x, updatedConfig); // update x in place
                console.log(chalk.green(`Main server updated to: ${newMainServer}`));
            } catch (err: any) {
                console.log(chalk.red('Failed to update main server name:', err));
            }
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