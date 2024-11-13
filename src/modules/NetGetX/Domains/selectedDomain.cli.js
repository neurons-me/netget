import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig } from '../config/xConfig.js';
import { editOrDeleteDomain, logDomainInfo } from './domainsOptions.js';
import updateNginxConfig from './updateNginxConfig.js';
import domainSSLConfiguration from './SSL/ssl.cli.js';

const selectedDomain = async (domain) => {
        try {
            const xConfig = await loadOrCreateXConfig();
            const domainConfig = xConfig.domains[domain];
    
            if (!domainConfig) {
                console.log(chalk.red(`Domain ${domain} configuration not found.`));
                return;
            }
    
        logDomainInfo(domainConfig, domain);
        const options = [
            { name: 'Edit/Delete Domain', value: 'editOrDelete' },
            { name: 'SSL Configuration', value: 'sslConfig' },
            // { name: 'Add New SubDomain', value: 'addNewSubDomain' },
            { name: 'Set Up Server Block', value: 'setupServerBlock' },
            { name: 'Back to Domains Menu', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select an option:',
                choices: options
            }
        ]);

        switch (answer.action) {
            case 'editOrDelete':
                await editOrDeleteDomain(domain);
                break;
            case 'sslConfig':
                await domainSSLConfiguration(domain);
                break;
            case 'addNewSubDOmain':
                await addNewSubDomain(domain);
                break;
            case 'setupServerBlock':
                await updateNginxConfig(domain);
                break;
            case 'back':
                return;
            case 'exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit(); 
            default:
                console.log(chalk.red('Invalid selection. Please try again.'));
        }

        // After an action, redisplay the menu
        await selectedDomain(domain);
    } catch (error) {
        console.error(chalk.red('An error occurred in the Selected Domain Menu:', error.message));
    }
};

export default selectedDomain;
