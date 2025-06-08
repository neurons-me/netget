//netget/src/modules/NetGetX/Domains/domainsOptions.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import NetGetX_CLI from '../NetGetX.cli.js';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.js';
import { scanAndLogCertificates } from './SSL/SSLCertificates.js';
import { registerDomain, deleteDomain, updateDomainTarget, updateDomainType } from '../../../sqlite/utils_sqlite3.js';
import domainsMenu from './domains.cli.js';
import sqlite3 from 'sqlite3';

/**
 * Logs the domain information to the console.
 * @memberof module:NetGetX.Domains
 * @param {Object} domainConfig - The domain configuration object.
 * @param {string} domain - The domain name.
 */ 
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

/**
 * Logs the domain information to the console for all domains in the domains object.
 * @memberof module:NetGetX.Domains
 * @param {Array} domains - The domains array from xConfig.
 */ 
const displayDomains = (domains) => {
    console.log('\nConfigured Domains:');
    domains.forEach(domain => console.log(`- ${domain}`));
};

/**
 * Logs the domain information to the console for all domains in the domains object.
 * @memberof module:NetGetX.Domains
 * @param {Object} domainsConfig - The domains configuration object from xConfig.
 */
const logAllDomainsTable = (domainsConfig) => {
    console.log(chalk.blue('\nDomains Information:'));
    const domainTable = Object.keys(domainsConfig).map(domain => ({
        Domain: domain,
        
    }));
    console.table(domainTable);
};

/**
 * Muestra la tabla de dominios leyendo desde la base de datos SQLite3.
 */
const domainsTable = () => {
    const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.log(chalk.red('Error opening database:'), err.message);
            return;
        }
    });

    db.all('SELECT domain, target, type FROM domains ORDER BY domain', [], (err, rows) => {
        if (err) {
            console.log(chalk.red('Error reading domains:'), err.message);
            db.close();
            return;
        }
        if (rows.length === 0) {
            console.log(chalk.yellow('No domains configured.'));
        } else {
            console.log(chalk.blue('\nDomains Information:'));
            console.table(rows.map(row => ({
                Domain: row.domain,
                Target: row.target,
                Type: row.type
            })));
        }
        db.close();
    });
};

const validateDomain = (domain) => {
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,6}$/;
    return domainRegex.test(domain) ? true : 'Enter a valid domain (e.g., example.com or sub.example.com)';
};


/**
 * Adds a new domain to the xConfig object.
 * @memberof module:NetGetX.Domains
 * @returns {Promise<void>}
 */
const addNewDomain = async () => {
    while (true) {
        const description_message = 
            'Add a new domain to your NetGetX configuration. You can choose to serve static content or forward traffic to a specific port on your server.\n' +
            chalk.blue('Available Service Types:\n' +
            '- Serve Static Content: Host static files (like HTML, CSS, JS, images) from a folder on your server. Great for simple websites or landing pages.\n' +
            '- Forward Port: Forward all incoming traffic to a specific port on your server. Useful for connecting your domain to a backend service, app, or container running on a different port.\n\n') +
            chalk.white('Select the type of service for this domain:');
        const serviceTypeAnswer = await inquirer.prompt([
            {
            type: 'list',
            name: 'serviceType',
            message: description_message,
            validate: input => input ? true : 'Service type is required.',
            choices: [
                { name: 'Serve Static Content', value: 'static' },
                { name: 'Forward Port', value: 'server' },
                { name: 'Back', value: 'back' }
            ]
            }
        ]);

        if (serviceTypeAnswer.serviceType === 'back') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const type = serviceTypeAnswer.serviceType;

        let port = '';
        if (serviceTypeAnswer.serviceType === 'server') {
            const forwardPortAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'server',
                message: 'Enter the forward port for this domain (type /b to go back):',
                validate: input => {
                if (input === '/b') return true;
                const portNum = Number(input);
                if (
                    !Number.isInteger(portNum) ||
                    portNum < 1 ||
                    portNum > 65535
                ) {
                    return 'Enter a valid port number (1-65535)';
                }
                return true;
                }
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
            validate: input => {
                if (input === '/b') return true;
                // Simple email regex validation
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(input) ? true : 'Enter a valid email address.';
            }
            }
        ]);

        if (emailAnswer.email === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const ownerAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'owner',
                message: 'Enter the owner of this domain (type /b to go back):',
                validate: input => input ? true : 'Owner is required.'
            }
        ]);

        if (ownerAnswer.owner === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const { domain, email, owner } = { ...domainAnswer, ...emailAnswer, ...ownerAnswer };
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
            owner: owner,
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
        await registerDomain(
            domain,
            domain,
            email, 
            'letsencrypt', 
            '', 
            '', 
            port, 
            type,
            '',
            owner);

        console.log(chalk.green(`Domain ${domain} added successfully.`));
        return;  // Exit the loop after successful addition
    }
};

/**
 * Adds a subdomain to the specified domain.
 * @memberof module:NetGetX.Domains
 * @param {string} domain - The domain to add the subdomain to.
 * @returns {Promise<void>}
 */
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

    const ownerAnswer = await inquirer.prompt([
        {
            type: 'input',
            name: 'owner',
            message: 'Enter the owner of this subdomain (type /b to go back):',
            validate: input => input ? true : 'Owner is required.'
        }
    ]);

    if (ownerAnswer.owner === '/b') {
        console.log(chalk.blue('Going back to the previous menu...'));
        return;
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
        "type": serviceTypeAnswer.serviceType,
        "owner": ownerAnswer.owner
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
    await registerDomain(
        subdomain,
        domain,
        xConfig.domains[domain].email, 
        'letsencrypt', 
        xConfig.domains[domain].SSLCertificateSqlitePath, 
        xConfig.domains[domain].SSLCertificateKeySqlitePath, 
        port, 
        serviceTypeAnswer.serviceType,
        '',
        ownerAnswer.owner);

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

/**
 * Edits or deletes a domain from the xConfig object.
 * @memberof module:NetGetX.Domains
 * @param {string} domain - The domain to edit or delete.
 * @returns {Promise<void>}
 */ 
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
                    console.log(chalk.blue('Going back to the previous menu...'));
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

/**
 * Displays the advance settings for the domain.
 * @memberof module:NetGetX.Domains
 * @returns {Promise<void>}
 */
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
                'Back'
            ]
        });

        if (answers.option === 'Back') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        switch (answers.option) {
            case 'Scan All SSL Certificates Issued':
                await scanAndLogCertificates();
        }
    
    } 
    catch (error) {
        console.error(chalk.red('An error occurred in the Advance Domain Menu:', error.message));
    }    
};

const linkDevelopmentAppProject = async (domain) => {
    const { projectPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'projectPath',
            message: 'Enter the path where the project is being developed:',
        }
    ]);

    const xConfig = await loadOrCreateXConfig();
    xConfig.domains[domain].projectPath = projectPath;
    await saveXConfig(xConfig);
    await updateDomain(
        domain,
        xConfig.domains[domain].email,
        'letsencrypt',
        xConfig.domains[domain].SSLCertificateSqlitePath, 
        xConfig.domains[domain].SSLCertificateKeySqlitePath, 
        xConfig.domains[domain].target,
        xConfig.domains[domain].type,
        projectPath
    );

    console.log(chalk.green(`Linked development app project at ${projectPath} with domain ${domain}.`));
};

export {
    displayDomains,
    validateDomain,
    addNewDomain,
    addSubdomain,
    editOrDeleteDomain,
    logDomainInfo,
    logAllDomainsTable,
    linkDevelopmentAppProject,
    domainsTable,
    advanceSettings
};
