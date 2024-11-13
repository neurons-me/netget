//netget/src/modules/NetGetX/Domains/domains.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig } from '../config/xConfig.js';
import NetGetX_CLI from '../NetGetX.cli.js';
import SelectedDomain from './selectedDomain.cli.js';
import { addNewDomain, advanceSettings, domainsTable } from './domainsOptions.js';
import {scanAndLogCertificates} from './SSL/SSLCertificates.js';

const domainsMenu = async () => {
    try {
        console.clear();
        const xConfig = await loadOrCreateXConfig();
        const domains = Object.keys(xConfig.domains || {});

        if (domains.length === 0) {
            console.log(chalk.red('No domains configured.'));
        }

        domainsTable(xConfig.domains);
        
        const options = [
            new inquirer.Separator(),
            ...domains.map(domain => ({ name: domain, value: domain })),
            new inquirer.Separator(),
            { name: 'Add New Domain', value: 'addNewDomain' },
            { name: 'Advance Domain Settings', value: 'advance'},
            { name: 'Back to NetGetX Settings', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select a domain or add a new one:',
                choices: options
            }
        ]);

        switch (answer.action) {
            case 'addNewDomain':
                await addNewDomain();
                break;
            case 'advance':
                await advanceSettings();
                return;
            case 'back':
                console.log(chalk.green('Returning to NetGetX Settings...'));
                await NetGetX_CLI(xConfig);
                return;
            case 'exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit();   
            default:
                const domain = answer.action;
                await SelectedDomain(domain);
        }

        // After an action, redisplay the menu
        await domainsMenu();
    } catch (error) {
        console.error(chalk.red('An error occurred in the Domains Menu:', error.message));
    }
};

export default domainsMenu;
