//netget/src/modules/NetGetX/Domains/domainsOptions.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import NetGetX_CLI from '../NetGetX.cli.js';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.js';
import { scanAndLogCertificates } from './SSL/SSLCertificates.js';
import { registerDomain, deleteDomain, updateDomainTarget, updateDomainType } from '../../../sqlite/utils_sqlite3.js';

// Used to log the domain information to the console in the selected domain.
const logDomainInfo = (domainConfig, domain) => {
    if (domainConfig.subDomains && Object.keys(domainConfig.subDomains).length > 0) {
        console.log(chalk.blue('\nDomain Information:'));
        const subDomainsTable = Object.keys(domainConfig.subDomains).map(subDomain => ({
            Subdomain: subDomain,
            Target: domainConfig.subDomains[subDomain].target,
            Type: domainConfig.subDomains[subDomain].type
        }));
        console.table(subDomainsTable);
    } else {
        console.log(chalk.yellow('No subdomains configured.'));
    }
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
        
    }));
    console.table(domainTable);
};

// TODO //
// This one is displayed in the domains MainMenu, need to be reconfigurated
const domainsTable = (domainsConfig) => {
    console.log(chalk.blue('\nDomains Information:'));
    const domainTable = Object.keys(domainsConfig).map(domain => ({
        Domain: domain,
        Target: domainsConfig[domain].target,
        Type: domainsConfig[domain].type

    }));
    console.table(domainTable);
};

const validateDomain = (domain) => {
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,6}$/;
    return domainRegex.test(domain) ? true : 'Enter a valid domain (e.g., example.com or sub.example.com)';
};

const addNewDomain = async () => {
    while (true) {
        const serviceTypeAnswer = await inquirer.prompt([
            {
                type: 'list',
                name: 'serviceType',
                message: 'Select the type of service for this domain:',
                choices: [
                    { name: 'Serve Static Content', value: 'static' },
                    { name: 'Forward Port', value: 'server' }
                ]
            }
        ]);

        const type = serviceTypeAnswer.serviceType;

        let port = '';
        if (serviceTypeAnswer.serviceType === 'server') {
            const forwardPortAnswer = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'server',
                    message: 'Enter the forward port for this domain (type /b to go back):',
                    validate: input => input ? true : 'Forward port is required.'
                }
            ]);

            if (forwardPortAnswer.server === '/b') {
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
            }

            port = forwardPortAnswer.server;
        } else if (serviceTypeAnswer.serviceType === 'static') {
            const staticPathAnswer = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'staticPath',
                    message: 'Enter the path to the static file you want to serve (type /b to go back):',
                    validate: input => input ? true : 'Static file path is required.'
                }
            ]);

            if (staticPathAnswer.staticPath === '/b') {
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
            }

            port = staticPathAnswer.staticPath;
        }

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

        const { domain, email} = { ...domainAnswer, ...emailAnswer };
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
            email: email,
            target: port,
            type: type,
            subDomains:{}
        };

        // Save only the new domain configuration
        xConfig.domains[domain] = newDomainConfig;
        // Sort the domains alphabetically
        const sortedDomains = Object.keys(xConfig.domains).sort().reduce((acc, key) => {
            acc[key] = xConfig.domains[key];
            return acc;
        }, {});
        xConfig.domains = sortedDomains;
        await saveXConfig({ domains: xConfig.domains });
        await registerDomain(domain, email, 'letsencrypt', '', '', port, type, '');

        console.log(chalk.green(`Domain ${domain} added successfully.`));
        return;  // Exit the loop after successful addition
    }
};

const addSubdomain = async (domain) => {
    const { subdomain } = await inquirer.prompt([
        {
            type: 'input',
            name: 'subdomain',
            message: 'Enter the subdomain name:',
        }
    ]);

    if (!subdomain) {
        console.log(chalk.red('Subdomain name cannot be empty.'));
        return;
    }

    const serviceTypeAnswer = await inquirer.prompt([
        {
            type: 'list',
            name: 'serviceType',
            message: 'Select the type of service for this domain:',
            choices: [
                { name: 'Serve Static Content', value: 'static' },
                { name: 'Forward Port', value: 'server' }
            ]
        }
    ]);

    let port = '';
    if (serviceTypeAnswer.serviceType === 'server') {
        const forwardPortAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'server',
                message: 'Enter the forward port for this domain (type /b to go back):',
                validate: input => input ? true : 'Forward port is required.'
            }
        ]);

        if (forwardPortAnswer.server === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        port = forwardPortAnswer.server;
    } else if (serviceTypeAnswer.serviceType === 'static') {
        const staticPathAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'staticPath',
                message: 'Enter the path to the static file you want to serve (type /b to go back):',
                validate: input => input ? true : 'Static file path is required.'
            }
        ]);

        if (staticPathAnswer.staticPath === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        port = staticPathAnswer.staticPath;
    }

    const xConfig = await loadOrCreateXConfig();

    if (!xConfig.domains[domain].subDomains) {
        xConfig.domains[domain].subDomains = {};
    }

    if (xConfig.domains[domain].subDomains[subdomain]) {
        console.log(chalk.red(`Subdomain ${subdomain} already exists for domain ${domain}.`));
        return;
    }

    const newDomainConfig = {
        "target": port,
        "type": serviceTypeAnswer.serviceType
    }

    xConfig.domains[domain].subDomains[subdomain] = newDomainConfig;
    const sortedSubdomains = Object.keys(xConfig.domains[domain].subDomains).sort().reduce((acc, key) => {
        acc[key] = xConfig.domains[domain].subDomains[key];
        return acc;
    }, {});

    xConfig.domains[domain].subDomains = sortedSubdomains;

    // Save the updated configuration
    await saveXConfig({ domains: xConfig.domains });

    // Register the subdomain into the database
    await registerDomain(subdomain, xConfig.domains[domain].email, 'letsencrypt', xConfig.domains[domain].SSLCertificateSqlitePath, xConfig.domains[domain].SSLCertificateKeySqlitePath, port, serviceTypeAnswer.serviceType, '');

    console.log(chalk.green(`Subdomain ${subdomain} added to domain ${domain}.`));
    return;
};

const editDomainDetails = async (domain, domainConfig) => {
    const editOptions = await inquirer.prompt([
        {
            type: 'list',
            name: 'editOption',
            message: 'Select an option to edit:',
            choices: [
                { name: 'Edit Type', value: 'editType' },
                { name: 'Edit Target', value: 'editTarget' },
                { name: 'Back to Domains Menu', value: 'back' }
            ]
        }
    ]);

    switch (editOptions.editOption) {
        case 'editType':
            const typeAnswer = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'serviceType',
                    message: 'Select the new type of service for this domain:',
                    choices: [
                        { name: 'Serve Static Content', value: 'static' },
                        { name: 'Forward Port', value: 'server' }
                    ]
                }
            ]);
            domainConfig.type = typeAnswer.serviceType;
            await updateDomainType(domain, typeAnswer.serviceType);
            break;

        case 'editTarget':
            const targetAnswer = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'target',
                    message: 'Enter the new target for this domain:',
                    validate: input => input ? true : 'Target is required.'
                }
            ]);
            domainConfig.target = targetAnswer.target;
            await updateDomainTarget(domain, targetAnswer.target);
            break;

        case 'back':
            return domainConfig;
    }
    return domainConfig;
};

const editOrDeleteDomain = async (domain) => {
    console.clear();
    try {
        const xConfig = await loadOrCreateXConfig();
        const domainConfig = xConfig.domains[domain];

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found.`));
            return;
        }

        const options = [
            { name: 'Edit Domain', value: 'editDomain' },
            { name: 'Edit Subdomain', value: 'editSubdomain' },
            { name: 'Delete Domain', value: 'deleteDomain' },
            { name: 'Delete Subdomain', value: 'deleteSubdomain' },
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
                console.clear();
                const updatedConfig = await editDomainDetails(domain, domainConfig);
                xConfig.domains[domain] = updatedConfig;
                await saveXConfig({ domains: xConfig.domains });
                console.log(chalk.green(`Domain ${domain} configuration updated successfully.`));
                return;
            
            case 'editSubdomain':
                console.clear();
                const listsubDomains = Object.keys(xConfig.domains[domain].subDomains || {});
                if (listsubDomains.length === 0) {
                    console.log(chalk.red('No subdomains available to edit.'));
                }
                else {
                    const subDomainToEdit = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'subDomain',
                            message: 'Select a subdomain to edit:',
                            choices: [...listsubDomains, { name: 'Back', value: 'back' }]
                        }
                    ]);

                    if (subDomainToEdit.subDomain === 'back') {
                        console.log(chalk.blue('Going back to the previous menu...'));
                        return;
                    }

                    const updatedSubDomainConfig = await editDomainDetails(subDomainToEdit.subDomain, xConfig.domains[domain].subDomains[subDomainToEdit.subDomain]);
                    xConfig.domains[domain].subDomains[subDomainToEdit.subDomain] = updatedSubDomainConfig;
                    await saveXConfig({ domains: xConfig.domains });
                    console.log(chalk.green(`Subdomain ${subDomainToEdit.subDomain} configuration updated successfully.`));
                }
                return;

            case 'deleteDomain':
                const confirmDelete = await inquirer.prompt([
                    {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Are you sure you want to delete the domain ${domain}?`,
                    default: false
                    }
                ]);

                if (!confirmDelete.confirm) {
                    console.log(chalk.blue('Domain deletion was cancelled.'));
                    return;
                }
                delete xConfig.domains[domain];
                await deleteDomain(domain);
                await saveXConfig({ domains: xConfig.domains });
                console.log(chalk.green(`Domain ${domain} deleted successfully.`));
                return;

            case 'deleteSubdomain':
                const subDomains = Object.keys(xConfig.domains[domain].subDomains || {});
                if (subDomains.length === 0) {
                    console.log(chalk.red('No subdomains available to delete.'));
                } else {
                    const subDomainToDelete = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'subDomain',
                            message: 'Select a subdomain to delete:',
                            choices: [...subDomains, { name: 'Back', value: 'back' }]
                        }
                    ]);

                    if (subDomainToDelete.subDomain === 'back') {
                        console.log(chalk.blue('Going back to the previous menu...'));
                        return;
                    }

                    const confirmDelete = await inquirer.prompt([
                        {
                        type: 'confirm',
                        name: 'confirm',
                        message: `Are you sure you want to delete the subdomain ${subDomainToDelete.subDomain}?`,
                        default: false
                        }
                    ]);
    
                    if (!confirmDelete.confirm) {
                        console.log(chalk.blue('Subdomain deletion was cancelled.'));
                        return;
                    }
                    delete xConfig.domains[domain].subDomains[subDomainToDelete.subDomain];
                    await deleteDomain(subDomainToDelete.subDomain);
                    await saveXConfig({ domains: xConfig.domains });
                    console.log(chalk.green(`Subdomain ${subDomainToDelete.subDomain} deleted successfully.`));
                }
                return;

            case 'back':
                return;
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
    addSubdomain,
    editOrDeleteDomain,
    logDomainInfo,
    logAllDomainsTable,
    domainsTable,
    advanceSettings
};
