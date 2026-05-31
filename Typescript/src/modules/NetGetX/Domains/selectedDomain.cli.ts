import inquirer from 'inquirer';
import chalk from 'chalk';
import { logDomainInfo, addSubdomain, editOrDeleteDomain, editOrDeleteSubdomain, linkDevelopmentAppProject } from './domainsOptions.ts';
import domainSSLConfiguration from './SSL/selfSigned/ssl.cli.ts';
import { isReservedLocalDomain } from './reservedDomains.ts';
import { getDomainByName } from '../../../kernel/domainStore.js';
import type { DomainRecord } from '../../../kernel/domainStore.js';

// Interface for menu answers
interface SelectedDomainMenuAnswers {
    action: string;
}

/**
 * Domain Menu once a domain is selected
 * @memberof NetGetX.Domains
 * @param domain - The domain to display the menu
 * @returns A promise that resolves when the menu is completed
 */
async function selectedDomainMenu(domain: string): Promise<void> {
    try {
        if (isReservedLocalDomain(domain)) {
            console.log(chalk.yellow(`${domain} is the reserved Local gateway, not a routing-table domain.`));
            return;
        }

        const domainConfig: DomainRecord | undefined = await getDomainByName(domain);
        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found.`));
            return;
        }

        await logDomainInfo(domain);

        console.log(chalk.blue(`Selected Domain: ${domain}`));
        
        const choices = [
            { name: 'Add Subdomain', value: 'addSubdomain' },
            { name: 'Edit Route / Delete Domain', value: 'editOrDelete' },
            { name: 'Edit/Delete Subdomain', value: 'editOrDeleteSubdomain' },
            { name: 'SSL Configuration', value: 'sslConfig' },
            { name: 'Link Development App Project', value: 'linkDevApp' },
            { name: 'View Domain Configuration', value: 'view' },
            { name: 'Back to Domains Menu', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer: SelectedDomainMenuAnswers = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `What would you like to do with ${domain}?`,
                choices: choices
            }
        ]);

        switch (answer.action) {
            case 'addSubdomain':
                await addSubdomain(domain);
                break;
            case 'editOrDelete':
                await editOrDeleteDomain(domain);
                break;
            case 'editOrDeleteSubdomain':
                await editOrDeleteSubdomain(domain);
                break;
            case 'sslConfig':
                await domainSSLConfiguration(domain);
                break;
            case 'linkDevApp':
                await linkDevelopmentAppProject(domain);
                break;
            case 'view':
                console.table(domainConfig);
                return await selectedDomainMenu(domain);
            case 'back':
                return;
            case 'exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit(0);
                break;
            default:
                console.log(chalk.yellow('Invalid selection'));
                await selectedDomainMenu(domain);
        }

        // After an action, redisplay the menu
        await selectedDomainMenu(domain);

    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Selected Domain Menu:', error.message));
    }
}

export default selectedDomainMenu;
