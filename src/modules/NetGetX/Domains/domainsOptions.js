//netget/src/modules/NetGetX/Domains/domainsOptions.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.js';
import { scanAndLogCertificates } from './SSL/SSLCertificates.js';
import { registerDomain, updateDomainTarget, updateDomainType } from '../../../sqlite/utils_sqlite3.js';
import domainsMenu from './domains.cli.js';
import sqlite3 from 'sqlite3';

/**
 * Retrieves and displays the subdomains table for a given domain.
 * @param {string} domain - The parent domain to list subdomains for.
 */
function retrieveSubdomainsTable(domain) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY);
        db.all(
            // Exclude rows where domain === subdomain (shouldn't happen, but just in case)
            'SELECT domain, target, type, subdomain FROM domains WHERE subdomain = ? ORDER BY domain',
            [domain],
            (err, rows) => {
                db.close();
                if (err) {
                    console.log(chalk.red('Error reading subdomains:'), err.message);
                    return reject(err);
                }
            if (rows.length === 0) {
                // console.log(chalk.yellow('No subdomains configured for this domain.'));
                return resolve([]);
            } else {
                    console.log(chalk.blue('\nSubdomains for domain:'), chalk.green(domain));
                    const subDomainsTable = rows.map(row => ({
                        DomainAndSubdomain: row.domain,
                        Target: row.target,
                        Type: row.type
                    }));
                    return resolve(subDomainsTable);
                }
            }
        );
    });
}

/**
 * Logs the domain information to the console.
 * @memberof module:NetGetX.Domains
 * @param {Object} domainConfig - The domain configuration object.
 * @param {string} domain - The domain name.
 */
async function logDomainInfo(domain) {
    // console.table([{
    //     Domain: domainConfig.domain,
    //     Target: domainConfig.target,
    //     Type: domainConfig.type,
    //     Owner: domainConfig.owner,
    //     Email: domainConfig.email
    // }]);
    try {
        const subDomainsTable = await retrieveSubdomainsTable(domain);
        if (subDomainsTable.length > 0) {
            console.table(subDomainsTable);
        } else {
            console.log(chalk.yellow('No subdomains configured for this domain.'));
        }
    } catch (err) {
        console.error(chalk.red('Error retrieving subdomains:'), err.message);
    }
}

/**
 * Displays the domains table by reading from the SQLite3 database.
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

const validatePort = (port) => {
    const portNum = Number(port);
    if (
        !Number.isInteger(portNum) ||
        portNum < 1 ||
        portNum > 65535
    ) {
        return 'Enter a valid port number (1-65535)';
    }
    return true;
};


/**
 * Adds a new domain to the database.
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
                        return validatePort(input);
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

        // Verifica si el dominio ya existe en la base de datos
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY);
        const exists = await new Promise((resolve) => {
            db.get('SELECT 1 FROM domains WHERE domain = ? AND subdomain IS NULL', [domain], (err, row) => {
                db.close();
                resolve(!!row);
            });
        });
        if (exists) {
            console.log(chalk.red(`Domain ${domain} already exists.`));
            return;
        }
        registerDomain(
            domain,
            domain,  // No subdomain for the main domain
            email,
            'letsencrypt',  // Default SSL mode
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
    try {
        const { subdomain } = await inquirer.prompt([
            {
                type: 'input',
                name: 'subdomain',
                message: 'Enter the subdomain name (type /b to go back):',
                validate: input => {
                    if (input === '/b') return true;
                    if (!input) return 'Subdomain name cannot be empty.';
                    return true;
                }
            }
        ]);

        if (subdomain === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const serviceTypeAnswer = await inquirer.prompt([
            {
            type: 'list',
            name: 'serviceType',
            message: 'Select the type of service for this domain:',
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

        // Retrieve email, SSLCertificateSqlitePath, and SSLCertificateKeySqlitePath from the parent domain in the database
        let parentDomainConfig;
        try {
            const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY);
            parentDomainConfig = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT email, sslCertificate, sslCertificateKey FROM domains WHERE domain = ?',
                    [domain],
                    (err, row) => {
                        db.close();
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });
        } catch (err) {
            console.log(chalk.red('Error retrieving parent domain config:'), err.message);
            return;
        }

        if (!parentDomainConfig) {
            console.log(chalk.red(`Parent domain ${domain} not found in database.`));
            return;
        }

        try {
            await registerDomain(
                subdomain,
                domain,
                parentDomainConfig.email,
                'letsencrypt',
                parentDomainConfig.sslCertificate,
                parentDomainConfig.sslCertificateKey,
                port,
                serviceTypeAnswer.serviceType,
                '',
                ownerAnswer.owner
            );
        } catch (err) {
            console.log(chalk.red('Error registering subdomain:'), err.message);
            return;
        }
    } catch (err) {
        console.log(chalk.red('An error occurred while adding the subdomain:'), err.message);
        return;
    }

    console.log(chalk.green(`Subdomain ${subdomain} added to domain ${domain}.`));
    return;
};

const editDomainDetails = async (domain) => {
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
                        { name: 'Forward Port', value: 'server' },
                        { name: 'Back', value: 'back' }
                    ]
                }
            ]);
            if (typeAnswer.serviceType === 'back') {
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
            }

            await updateDomainType(domain, typeAnswer.serviceType);
            break;

        case 'editTarget':
            const targetAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'target',
                message: 'Enter the new target for this domain (type /b to go back):',
                validate: input => {
                if (input === '/b') return true;
                return input ? true : 'Target is required.';
                }
            }
            ]);
            if (targetAnswer.target === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
            }
            await updateDomainTarget(domain, targetAnswer.target);
            break;

        case 'back':
            return;
    }
    return;
};

/**
 * Edit or delete a subdomain for a given domain.
 * @param {string} domain - The parent domain.
 * @returns {Promise<void>}
 */
const editOrDeleteSubdomain = async (domain) => {
    console.clear();
    try {
        // Listar subdominios asociados a este dominio
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY);
        const subdomains = await new Promise((resolve) => {
            db.all('SELECT domain FROM domains WHERE subdomain = ? ORDER BY domain', [domain], (err, rows) => {
                db.close();
                resolve(rows.map(r => r.domain));
            });
        });

        if (subdomains.length === 0) {
            console.log(chalk.red('No subdomains available to edit or delete.'));
            return;
        }

        const { subDomain } = await inquirer.prompt([
            {
                type: 'list',
                name: 'subDomain',
                message: 'Select a subdomain to edit or delete:',
                choices: [...subdomains, { name: 'Back', value: 'back' }]
            }
        ]);

        if (subDomain === 'back') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `What do you want to do with subdomain ${subDomain}?`,
                choices: [
                    { name: 'Edit Subdomain', value: 'edit' },
                    { name: 'Delete Subdomain', value: 'delete' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (action === 'back') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        if (action === 'edit') {
            await editDomainDetails(subDomain);
            console.log(chalk.green(`Subdomain ${subDomain} edited successfully.`));
        } else if (action === 'delete') {
            const { confirm } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Are you sure you want to delete the subdomain ${subDomain}?`,
                    default: false
                }
            ]);
            if (!confirm) {
                console.log(chalk.blue('Subdomain deletion was cancelled.'));
                return;
            }
            const dbDel = new sqlite3.Database('/opt/.get/domains.db');
            dbDel.run('DELETE FROM domains WHERE domain = ? AND subdomain = ?', [subDomain, domain], (err) => {
                if (err) {
                    console.log(chalk.red('Error deleting subdomain:'), err.message);
                } else {
                    console.log(chalk.green(`Subdomain ${subDomain} deleted successfully.`));
                }
                dbDel.close();
            });
        }
    } catch (error) {
        console.error(chalk.red('An error occurred in the Edit/Delete Subdomain Menu:', error.message));
    }
};

/**
 * Edits or deletes a domain from the database.
 * @memberof module:NetGetX.Domains
 * @param {string} domain - The domain to edit or delete.
 * @returns {Promise<void>}
 */
const editOrDeleteDomain = async (domain) => {
    console.clear();
    try {
        // Leer la configuración del dominio desde la base de datos
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY);
        const domainConfig = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM domains WHERE domain = ?', [domain], (err, row) => {
                db.close();
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found in database.`));
            return;
        }

        const options = [
            { name: 'Edit Domain', value: 'editDomain' },
            { name: 'Delete Domain', value: 'deleteDomain' },
            { name: 'Back', value: 'back' }
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
                await editDomainDetails(domain);
                console.log(chalk.green(`Domain ${domain} edited successfully.`));
                return;
            case 'deleteDomain':
                const confirmDelete = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirm',
                        message: `Are you sure you want to delete the domain ${domain}? (This will also delete all associated subdomains)`,
                        default: false
                    }
                ]);
                if (!confirmDelete.confirm) {
                    console.log(chalk.blue('Going back to the previous menu...'));
                    return;
                }
                // Elimina el dominio y sus subdominios asociados
                const dbDel = new sqlite3.Database('/opt/.get/domains.db');
                dbDel.run('DELETE FROM domains WHERE domain = ? OR subdomain = ?', [domain, domain], (err) => {
                    if (err) {
                        console.log(chalk.red('Error deleting domain:'), err.message);
                    } else {
                        console.log(chalk.green(`Domain ${domain} and its subdomains deleted successfully.`));
                    }
                    dbDel.close();
                });
                await domainsMenu();
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
async function advanceSettings() {
    try {
        const answers = await inquirer.prompt({
            type: 'list',
            name: 'action',
            message: 'Select an option:',
            choices: [
                { name: 'Scan All SSL Certificates Issued', value: 'scan' },
                { name: 'View Certbot Logs', value: 'logs' },
                { name: 'Back', value: 'back' }
            ]
        });

        switch (answers.action) {
            case 'scan':
                await scanAndLogCertificates();
            case 'logs':
                console.log(chalk.yellow('Certbot logs soon to be implemented.'));
            case 'back':
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
        }
        await advanceSettings();
    }
    catch (error) {
        console.error(chalk.red('An error occurred in the Advance Domain Menu:', error.message));
    }
}

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
    validateDomain,
    addNewDomain,
    addSubdomain,
    editOrDeleteDomain,
    editOrDeleteSubdomain,
    logDomainInfo,
    linkDevelopmentAppProject,
    domainsTable,
    advanceSettings,
    validatePort
};