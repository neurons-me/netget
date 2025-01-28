import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig } from '../config/xConfig.js';



/**
 * Menu for managing the Main Server configuration.
 * @param {Object} x - The user configuration object.
 */
async function mainServerMenu(x) {
    let exit = false;
    while (!exit) {
        const xConfig = await loadOrCreateXConfig();
        const mainServerName = xConfig.mainServerName;
        console.log(`Current Main Server Name: ${mainServerName}`);
        const answers = await inquirer.prompt({
            type: 'list',
            name: 'option',
            message: 'Main Server Menu - Select an action:',
            choices: [
                'View Main Server Configuration',
                'Back to NetGetX Menu',
                'Exit'
            ]
        });
        
        switch (answers.option) {
            case 'View Main Server Configuration':
                console.log(chalk.blue('Displaying current main server configuration...'));
                console.log(chalk.blue('Main Server Output Port:', x.xMainOutPutPort));
                console.log(chalk.blue('Static Path:', x.static));
                
                const mainDomain = x.domains[mainServerName];
                if (!mainDomain) {
                    console.log(chalk.blue('No available domains.'));
                } else {
                    console.log(chalk.blue('Main Domain:', mainServerName));
                    const subDomains = mainDomain.subDomains || {};
                    const subDomainNames = Object.keys(subDomains);
                    if (subDomainNames.length === 0) {
                        console.log(chalk.blue('No available subdomains.'));
                    } else {
                        console.log(chalk.blue('Subdomains:', subDomainNames));
                    }
                }
                
                // Implement viewing logic here
                break;
            case 'Back to NetGetX Menu':
                exit = true;
                break;
            case 'Exit':
                console.log(chalk.blue('Exiting netGet...'));
                process.exit();
            default:
                console.log(chalk.red('Invalid choice, please try again.'));
                break;
        }
    }
}

export default mainServerMenu;
