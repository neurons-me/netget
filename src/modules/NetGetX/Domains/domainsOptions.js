//netget/src/modules/NetGetX/Domains/domainsOptions.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import NetGetX_CLI from '../NetGetX.cli.js';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.js';
import { scanAndLogCertificates } from './SSL/SSLCertificates.js';
import { addDomain, deleteDomain } from '../../../sqlite/utils_sqlite3.js';

const logDomainInfo = (domainConfig, domain) => {
    console.log(chalk.blue('\nDomain Information:'));
    console.table([{
        Domain: domain,
        Email: domainConfig.email,
        SSLCertificatesPath: domainConfig.SSLCertificatesPath
    }]);
};

const displayDomains = (domains) => {
    console.log('\nConfigured Domains:');
    domains.forEach(domain => console.log(`- ${domain}`));
};

/**
 * Logs the domain information to the console for all domains in the domains object.
 * @param {Object} domainsConfig - The domains configuration object from xConfig.
 */
const logAllDomainsTable = (domainsConfig) => {
    console.log(chalk.blue('\nDomains Information:'));
    const domainTable = Object.keys(domainsConfig).map(domain => ({
        Domain: domain,
        Email: domainsConfig[domain].email,
        SSLCertificatesPath: domainsConfig[domain].SSLCertificatesPath || 'N/A'
    }));
    console.table(domainTable);
};

const domainsTable = (domainsConfig) => {
    console.log(chalk.blue('\nDomains Information:'));
    const domainTable = Object.keys(domainsConfig).map(domain => ({
        Domain: domain,
        SSLCertificateName: domainsConfig[domain].SSLCertificateName || 'N/A'
    }));
    console.table(domainTable);
};

const validateDomain = (domain) => {
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,6}$/;
    return domainRegex.test(domain) ? true : 'Enter a valid domain (e.g., example.com or sub.example.com)';
};

const addNewDomain = async () => {
    while (true) {
        const domainAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'domain',
                message: 'Enter the new domain (e.g., example.com or sub.example.com) (type /b to go back):',
                validate: input => {
                    if (input === '/b') return true;
                    return validateDomain(input);
                }
            }
        ]);

        if (domainAnswer.domain === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const emailAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'email',
                message: 'Enter the email associated with this domain (type /b to go back):',
                validate: input => input ? true : 'Email is required.'
            }
        ]);

        if (emailAnswer.email === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const { domain, email } = { ...domainAnswer, ...emailAnswer };
        const xConfig = await loadOrCreateXConfig();

        if (!xConfig.domains) {
            xConfig.domains = {};
        }

        if (xConfig.domains[domain]) {
            console.log(chalk.red(`Domain ${domain} already exists.`));
            return;
        }

        const newDomainConfig = {
            sslMode: 'letsencrypt',
            email: email
        };

        // Save only the new domain configuration
        xConfig.domains[domain] = newDomainConfig;
        await saveXConfig({ domains: xConfig.domains });
        await addDomain(domain, email, 'letsencrypt', '', '', '');

        console.log(chalk.green(`Domain ${domain} added successfully.`));
        return;  // Exit the loop after successful addition
    }
};

const addNewSubDomain = async (domain) => {
    while (true) {
        const domainAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'subdomain',
                message: 'Enter the new subdomain (e.g., sub.example.com) (type /b to go back):',
                validate: input => {
                    if (input === '/b') return true;
                    return validateDomain(input);
                }
            }
        ]);

        if (domainAnswer.subdomain === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const path = '/etc/nginx/XBlocks-available/' + domain;

        try {
            const data = await fs.readFile(path, 'utf8');
            console.log(chalk.green(`Content of ${path}:`));
            console.log(data);
        } catch (error) {
            console.error(chalk.red(`Error reading file ${path}:`, error.message));
        }

    }
};


const editOrDeleteDomain = async (domain) => {
    try {
        const xConfig = await loadOrCreateXConfig();
        const domainConfig = xConfig.domains[domain];

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found.`));
            return;
        }

        const options = [
            { name: 'Edit Domain', value: 'editDomain' },
            { name: 'Delete Domain', value: 'deleteDomain' },
            { name: 'Back to Domains Menu', value: 'back' }
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
            case 'editDomain':
                // Implement edit domain functionality
                console.log(chalk.green(`Editing domain ${domain}...`));
                // Add your edit domain logic here
                break;
            case 'deleteDomain':
                // Implement delete domain functionality
                delete xConfig.domains[domain];
                await deleteDomain(domain);
                await saveXConfig({ domains: xConfig.domains });
                console.log(chalk.green(`Domain ${domain} deleted successfully.`));
                return;
            case 'back':
                return;
            default:
                console.log(chalk.red('Invalid selection. Please try again.'));
        }

        // After an action, redisplay the menu
        await editOrDeleteDomain(domain);
    } catch (error) {
        console.error(chalk.red('An error occurred in the Edit/Delete Domain Menu:', error.message));
    }
};

const advanceSettings = async () => {
    try{
        const xConfig = await loadOrCreateXConfig();
        const answers = await inquirer.prompt({
            type : 'list',
            name : 'option',
            message : 'Select an option:',
            choices: [
                'Scan All SSL Certificates Issued',
                'View Certbot Logs',
                'Back to NetGetX Settings'
            ]
        });

        switch (answers.option) {
            case 'Scan All SSL Certificates Issued':
                await scanAndLogCertificates();
            case 'back':
                console.log(chalk.green('Returning to NetGetX Settings...'));
                await NetGetX_CLI(xConfig);
        }
    
    } 
    catch (error) {
        console.error(chalk.red('An error occurred in the Advance Domain Menu:', error.message));
    }    
};

export {
    displayDomains,
    validateDomain,
    addNewDomain,
    editOrDeleteDomain,
    logDomainInfo,
    logAllDomainsTable,
    domainsTable,
    advanceSettings
};
