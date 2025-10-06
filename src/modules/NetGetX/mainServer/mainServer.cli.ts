import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveXConfig } from '../config/xConfig.ts';
import { XStateData } from '../xState.ts';

// Interface for menu options
interface MainServerMenuOption {
    name: string;
    value: 'editMainServer' | 'back';
}

// Interface for menu answers
interface MainServerMenuAnswers {
    mainServerMenuAction: 'editMainServer' | 'back';
}

// Interface for edit answers
interface EditServerAnswers {
    newMainServer: string;
}

/**
 * Menu for managing the Main Server configuration.
 * @memberof module:NetGetX
 * @param x - The user configuration object.
 */
async function mainServerMenu(x: XStateData): Promise<void> {
    console.log(chalk.blue('Displaying current main server configuration...'));
    console.log(chalk.blue('Static Path:', x.static));
    
    const mainDomain: string | undefined = x.mainServerName;
    if (!mainDomain) {
        console.log(chalk.blue('No available domains.'));
    } else {
        console.log(chalk.blue('Main Domain:', x.mainServerName));
    }
    
    let back: boolean = false;
    while (!back) {
        const mainServerMenuOptions: MainServerMenuOption[] = [
            { name: 'Edit Main Server Name', value: 'editMainServer' },
            { name: 'Back', value: 'back' }
        ];
        
        const { mainServerMenuAction }: MainServerMenuAnswers = await inquirer.prompt([
            {
                type: 'list',
                name: 'mainServerMenuAction',
                message: chalk.cyan('Main Server Configuration:'),
                choices: mainServerMenuOptions
            }
        ]);
        
        switch (mainServerMenuAction) {
            case 'editMainServer':
                let editBack: boolean = false;
                while (!editBack) {
                    const { newMainServer }: EditServerAnswers = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'newMainServer',
                            message: 'Enter the new main server name:',
                            default: x.mainServerName || ''
                        }
                    ]);
                    
                    if (newMainServer && newMainServer.trim()) {
                        try {
                            await saveXConfig({ mainServerName: newMainServer.trim() });
                            console.log(chalk.green(`Main server name updated to: ${newMainServer.trim()}`));
                            x.mainServerName = newMainServer.trim();
                            editBack = true;
                        } catch (error: any) {
                            console.error(chalk.red('Error updating main server name:', error.message));
                        }
                    } else {
                        console.log(chalk.yellow('Please enter a valid server name.'));
                    }
                }
                break;
                
            case 'back':
                back = true;
                break;
                
            default:
                console.log(chalk.red('Invalid option selected.'));
                break;
        }
    }
}

export default mainServerMenu;