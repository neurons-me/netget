import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig } from '../config/xConfig.js';
import { editOrDeleteDomain, logDomainInfo, addSubdomain } from './domainsOptions.js';
import domainSSLConfiguration from './SSL/selfSigned/ssl.cli.js';

/**
 * Domain Menu once a domain is selected
 * @memberof NetGetX.Domains
 * @param {string} domain - The domain to display the menu
 * @returns {Promise<void>} - A promise that resolves when the menu is completed
 */
const selectedDomainMenu = async (domain) => {
        try {
            const xConfig = await loadOrCreateXConfig();
            const domainConfig = xConfig.domains[domain];
    
            if (!domainConfig) {
                console.log(chalk.red(`Domain ${domain} configuration not found.`));
                return;
            }
    
        logDomainInfo(domainConfig, domain);
        const options = [
            { name: 'Add Subdomain', value: 'addSubdomain' },
            { name: 'Edit/Delete Domain', value: 'editOrDelete' },
            { name: 'SSL Configuration', value: 'sslConfig' },
            { name: 'Link Development App Project', value: 'linkDevApp' },
            { name: 'Back to Domains Menu', value: 'back' },
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
            case 'addSubdomain':
                await addSubdomain(domain);
                break;
            case 'editOrDelete':
                await editOrDeleteDomain(domain);
                break;
            case 'sslConfig':
                await domainSSLConfiguration(domain);
                break;
            case 'linkDevApp':
                await linkDevelopmentAppProject(domain);
                break;
            case 'back':
                return;
            default:
                console.log(chalk.red('Invalid selection. Please try again.'));
        }

        // After an action, redisplay the menu
        await selectedDomainMenu(domain);
    } catch (error) {
        console.error(chalk.red('An error occurred in the Selected Domain Menu:', error.message));
    }
};

export default selectedDomainMenu;
