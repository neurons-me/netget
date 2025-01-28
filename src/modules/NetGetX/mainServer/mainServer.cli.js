import inquirer from 'inquirer';
import chalk from 'chalk';
import { changeServerName } from './utils.js';
import { loadOrCreateXConfig } from '../config/xConfig.js';
import { getXBlocksList } from '../XBlocks/XBlocksUtils.js';
import domainsMenu from '../Domains/domains.cli.js';



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
                'Change Main Server Name',
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
            case 'Change Main Server Name':
                if (!x.domains || Object.keys(x.domains).length === 0) {
                    console.log(chalk.red('No available domains to select from.'));
                    break;
                }

                const usedDomains = getXBlocksList(x.XBlocksAvailable).concat(getXBlocksList(x.XBlocksEnabled));
                const domainChoices = Object.keys(x.domains)
                    .filter(domain => !usedDomains.includes(x.domains[domain].domain))
                    .map(domain => ({
                        name: x.domains[domain].domain,
                        value: domain
                    }));

                domainChoices.push(
                    new inquirer.Separator(),
                    { name: 'Go Back', value: 'go_back' },
                    { name: 'Add New Domain', value: 'add_new_domain' }
                );

                const { selectedDomain } = await inquirer.prompt({
                    type: 'list',
                    name: 'selectedDomain',
                    message: 'Select a domain to set as the main server:',
                    choices: domainChoices
                });

                if (selectedDomain === 'go_back') {     
                    console.log(chalk.blue('Going back to the previous menu...'));
                    break;
                } else if (selectedDomain === 'add_new_domain') {
                    await domainsMenu();
                    break;
                }

                const newServerName = selectedDomain;

                try {
                    const success = await changeServerName(x.nginxPath, newServerName);
                    if (success) {
                        console.log(chalk.green(`Main server name changed to: ${newServerName}`));
                    } else {
                        console.log(chalk.red('Failed to change the main server name.'));
                    }
                } catch (error) {
                    console.error(chalk.red(`Failed to change the server name in the configuration file at ${x.nginxPath}: ${error.message}`));
                }
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
