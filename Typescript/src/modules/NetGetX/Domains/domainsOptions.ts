//netget/src/modules/NetGetX/Domains/domainsOptions.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadXConfig, saveXConfig } from '../config/xConfig.ts';
import type { XConfig } from '../config/xConfig.ts';
import { scanAndLogCertificates } from './SSL/SSLCertificates.ts';
import {
    registerDomain,
    updateDomainTarget,
    updateDomainType,
    updateDomain,
    getDomains,
    getDomainByName,
    deleteDomain,
} from '../../../kernel/domainStore.js';
import type { DomainRecord } from '../../../kernel/domainStore.js';
import domainsMenu from './domains.cli.ts';
import { isReservedLocalDomain } from './reservedDomains.ts';

// Interface for formatted subdomain table
interface SubdomainTableEntry {
    DomainAndSubdomain: string;
    Target: string;
    Type: string;
}

// Interface for domains table entry
interface DomainTableEntry {
    domain: string;
    email?: string;
    sslMode?: string;
    sslCertificate?: string;
    sslCertificateKey?: string;
    target: string;
    type: string;
}

const validateDomain = (domain: string): boolean | string => {
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,6}$/;
    return domainRegex.test(domain) ? true : 'Enter a valid domain (e.g., example.com or sub.example.com)';
};

const validatePort = (port: string): boolean | string => {
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return 'Enter a valid port number (1-65535)';
    }
    return true;
};

async function retrieveSubdomainsTable(domain: string): Promise<SubdomainTableEntry[]> {
    const all = await getDomains();
    const rows = all.filter(r => r.subdomain === domain && r.domain !== domain);
    if (rows.length === 0) return [];
    console.log(chalk.blue('\nSubdomains for domain:'), chalk.green(domain));
    return rows.map(row => ({
        DomainAndSubdomain: row.domain,
        Target: row.target || '',
        Type: row.type || '',
    }));
}

async function logDomainInfo(domain: string): Promise<void> {
    try {
        const subDomainsTable = await retrieveSubdomainsTable(domain);
        if (subDomainsTable.length > 0) {
            console.table(subDomainsTable);
        } else {
            console.log(chalk.yellow('No subdomains configured for this domain.'));
        }
    } catch (err: any) {
        console.error(chalk.red('Error retrieving subdomains:'), err.message);
    }
}

async function domainsTable(): Promise<void> {
    const rows = await getDomains();
    const visibleRows = rows.filter(row => !isReservedLocalDomain(row.domain));
    if (visibleRows.length === 0) {
        console.log(chalk.yellow('No domains registered.'));
    } else {
        console.log(chalk.blue('\nDomain registry:'));
        console.table(visibleRows.map(row => ({
            Domain: row.domain,
            Email: row.email || '',
            SSL: row.sslMode || '',
            Certificate: row.sslCertificate && row.sslCertificateKey ? 'configured' : '',
            Route: row.target && row.type ? `${row.type} -> ${row.target}` : 'inactive',
        })));
    }
}

async function addNewDomain(): Promise<void> {
    while (true) {
        const domainAnswer: any = await inquirer.prompt([{
            type: 'input', name: 'domain',
            message: 'Enter the domain to register (e.g., example.com or sub.example.com) (type /b to go back):',
            validate: (input: string) => input === '/b' ? true : validateDomain(input),
        }]);
        if (domainAnswer.domain === '/b') return;

        const emailAnswer: any = await inquirer.prompt([{
            type: 'input', name: 'email',
            message: 'Enter the email associated with this domain (type /b to go back):',
            validate: (input: string) => {
                if (input === '/b') return true;
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? true : 'Enter a valid email address.';
            },
        }]);
        if (emailAnswer.email === '/b') return;

        const ownerAnswer: any = await inquirer.prompt([{
            type: 'input', name: 'owner',
            message: 'Enter the owner of this domain (type /b to go back):',
            validate: (input: string) => input ? true : 'Owner is required.',
        }]);
        if (ownerAnswer.owner === '/b') return;

        const { domain, email, owner } = { ...domainAnswer, ...emailAnswer, ...ownerAnswer };

        const existing = await getDomainByName(domain);
        if (existing) {
            console.log(chalk.red(`Domain ${domain} already exists.`));
            return;
        }

        await registerDomain(domain, domain, email, 'letsencrypt', '', '', '', '', '', owner);
        console.log(chalk.green(`Domain ${domain} registered. It is not routed until you activate it in the Routing table.`));
        return;
    }
}

const addSubdomain = async (domain: string): Promise<void> => {
    try {
        const subdomainAnswer: any = await inquirer.prompt([{
            type: 'input', name: 'subdomain',
            message: 'Enter the subdomain name (type /b to go back):',
            validate: (input: string) => {
                if (input === '/b') return true;
                return input ? true : 'Subdomain name cannot be empty.';
            },
        }]);
        if (subdomainAnswer.subdomain === '/b') return;

        const ownerAnswer: any = await inquirer.prompt([{
            type: 'input', name: 'owner',
            message: 'Enter the owner of this subdomain (type /b to go back):',
            validate: (input: string) => input ? true : 'Owner is required.',
        }]);
        if (ownerAnswer.owner === '/b') return;

        const parentDomainConfig = await getDomainByName(domain);
        if (!parentDomainConfig) {
            console.log(chalk.red(`Parent domain ${domain} not found.`));
            return;
        }

        await registerDomain(
            subdomainAnswer.subdomain, domain,
            parentDomainConfig.email, 'letsencrypt',
            parentDomainConfig.sslCertificate, parentDomainConfig.sslCertificateKey,
            '', '', '', ownerAnswer.owner,
        );
        console.log(chalk.green(`Subdomain ${subdomainAnswer.subdomain} registered under ${domain}.`));
    } catch (err: any) {
        console.log(chalk.red('An error occurred while adding the subdomain:'), err.message);
    }
};

async function advanceSettings(): Promise<void> {
    try {
        const answers: any = await inquirer.prompt([{
            type: 'list', name: 'action', message: 'Select an option:',
            choices: [
                { name: 'Scan All SSL Certificates Issued', value: 'scan' },
                { name: 'View Certbot Logs', value: 'logs' },
                { name: 'Back', value: 'back' },
            ],
        }]);
        switch (answers.action) {
            case 'scan': await scanAndLogCertificates(); break;
            case 'logs': console.log(chalk.yellow('Certbot logs soon to be implemented.')); break;
            case 'back': return;
        }
        await advanceSettings();
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Advance Domain Menu:', error.message));
    }
}

const linkDevelopmentAppProject = async (domain: string): Promise<void> => {
    const projectPathAnswer: any = await inquirer.prompt([{
        type: 'input', name: 'projectPath',
        message: 'Enter the path where the project is being developed:',
    }]);
    try {
        const domainConfig = await getDomainByName(domain);
        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} not found.`));
            return;
        }
        await updateDomain(
            domain,
            domainConfig.subdomain, domainConfig.email, domainConfig.sslMode,
            domainConfig.sslCertificate, domainConfig.sslCertificateKey,
            domainConfig.target, domainConfig.type,
            projectPathAnswer.projectPath, domainConfig.owner,
        );
        console.log(chalk.green(`Linked development app project at ${projectPathAnswer.projectPath} with domain ${domain}.`));
    } catch (error: any) {
        console.log(chalk.red('Error linking development project:'), error.message);
    }
};

const editOrDeleteSubdomain = async (domain: string): Promise<void> => {
    console.clear();
    try {
        const all = await getDomains();
        const subdomains = all
            .filter(r => r.subdomain === domain && r.domain !== domain)
            .map(r => r.domain);

        if (subdomains.length === 0) {
            console.log(chalk.red('No subdomains available to edit or delete.'));
            return;
        }

        const subDomainAnswer: any = await inquirer.prompt({
            type: 'list', name: 'subDomain',
            message: 'Select a subdomain to edit or delete:',
            choices: [...subdomains, 'Back'],
        });
        if (subDomainAnswer.subDomain === 'Back') return;

        const actionAnswer: any = await inquirer.prompt([{
            type: 'list', name: 'action',
            message: `What do you want to do with subdomain ${subDomainAnswer.subDomain}?`,
            choices: [
                { name: 'Edit Subdomain', value: 'edit' },
                { name: 'Delete Subdomain', value: 'delete' },
                { name: 'Back', value: 'back' },
            ],
        }]);
        if (actionAnswer.action === 'back') return;

        if (actionAnswer.action === 'edit') {
            await editDomainDetails(subDomainAnswer.subDomain);
            console.log(chalk.green(`Subdomain ${subDomainAnswer.subDomain} edited successfully.`));
        } else if (actionAnswer.action === 'delete') {
            const confirmAnswer: any = await inquirer.prompt([{
                type: 'confirm', name: 'confirm',
                message: `Are you sure you want to delete the subdomain ${subDomainAnswer.subDomain}?`,
                default: false,
            }]);
            if (!confirmAnswer.confirm) return;
            await deleteDomain(subDomainAnswer.subDomain);
            console.log(chalk.green(`Subdomain ${subDomainAnswer.subDomain} deleted successfully.`));
        }
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Edit/Delete Subdomain Menu:', error.message));
    }
};

const editDomainDetails = async (domain: string): Promise<void> => {
    const editOptions: any = await inquirer.prompt([{
        type: 'list', name: 'editOption', message: 'Select an option to edit:',
        choices: [
            { name: 'Edit route type', value: 'editType' },
            { name: 'Edit route target', value: 'editTarget' },
            { name: 'Back', value: 'back' },
        ],
    }]);

    switch (editOptions.editOption) {
        case 'editType': {
            const typeAnswer: any = await inquirer.prompt([{
                type: 'list', name: 'newType', message: 'Select the new type for this domain:',
                choices: [
                    { name: 'Serve Static Content', value: 'static' },
                    { name: 'Forward Port', value: 'server' },
                ],
            }]);
            await updateDomainType(domain, typeAnswer.newType);
            console.log(chalk.green(`Domain type updated to ${typeAnswer.newType}`));
            break;
        }
        case 'editTarget': {
            const targetAnswer: any = await inquirer.prompt([{
                type: 'input', name: 'newTarget',
                message: 'Enter the new target (port number or file path):',
                validate: (input: string) => input ? true : 'Target is required.',
            }]);
            await updateDomainTarget(domain, targetAnswer.newTarget);
            console.log(chalk.green(`Domain target updated to ${targetAnswer.newTarget}`));
            break;
        }
        case 'back': return;
    }
};

const editOrDeleteDomain = async (domain: string): Promise<void> => {
    console.clear();
    try {
        const domainConfig = await getDomainByName(domain);
        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found.`));
            return;
        }

        const answer: any = await inquirer.prompt([{
            type: 'list', name: 'action', message: 'Select an option:',
            choices: [
                { name: 'Edit Domain', value: 'editDomain' },
                { name: 'Delete Domain', value: 'deleteDomain' },
                { name: 'Back', value: 'back' },
            ],
        }]);

        switch (answer.action) {
            case 'editDomain':
                console.clear();
                await editDomainDetails(domain);
                console.log(chalk.green(`Route settings for ${domain} edited successfully.`));
                return;
            case 'deleteDomain': {
                const confirmDelete: any = await inquirer.prompt([{
                    type: 'confirm', name: 'confirm',
                    message: `Are you sure you want to delete the domain ${domain}? (This will also delete all associated subdomains)`,
                    default: false,
                }]);
                if (!confirmDelete.confirm) return;
                // Delete domain and all its subdomains
                const all = await getDomains();
                const toDelete = all.filter(r => r.domain === domain || r.subdomain === domain);
                for (const r of toDelete) await deleteDomain(r.domain);
                console.log(chalk.green(`Domain ${domain} and its subdomains deleted successfully.`));
                return await domainsMenu();
            }
            case 'back': return;
        }

        await editOrDeleteDomain(domain);
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Edit/Delete Domain Menu:', error.message));
    }
};

export {
    validateDomain,
    validatePort,
    retrieveSubdomainsTable,
    logDomainInfo,
    domainsTable,
    addNewDomain,
    addSubdomain,
    editOrDeleteSubdomain,
    editDomainDetails,
    editOrDeleteDomain,
    linkDevelopmentAppProject,
    advanceSettings,
};
