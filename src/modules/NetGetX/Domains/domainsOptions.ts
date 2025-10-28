//netget/src/modules/NetGetX/Domains/domainsOptions.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.ts';
import type { XConfig } from '../config/xConfig.ts';
import { scanAndLogCertificates } from './SSL/SSLCertificates.ts'; // Now available in TypeScript
import { registerDomain, updateDomainTarget, updateDomainType } from '../../../sqlite/utils_sqlite3.ts';
import type { DomainRecord } from '../../../sqlite/utils_sqlite3.ts';
import domainsMenu from './domains.cli.ts';
import sqlite3 from 'sqlite3';

const xConfig = await loadOrCreateXConfig();
const sqliteDatabasePath: string = xConfig.sqliteDatabasePath;

// Interface for subdomain row from database
interface SubdomainRow {
    domain: string;
    target: string;
    type: string;
    subdomain: string;
}

// Interface for formatted subdomain table
interface SubdomainTableEntry {
    DomainAndSubdomain: string;
    Target: string;
    Type: string;
}

// Interface for domains table entry
interface DomainTableEntry {
    Domain: string;
    Target: string;
    Type: string;
}

// Interface for service type answers
interface ServiceTypeAnswer {
    serviceType: string;
}

// Interface for port/path answers
interface PortAnswer {
    server: string;
}

interface StaticPathAnswer {
    staticPath: string;
}

// Interface for domain input answers
interface DomainAnswer {
    domain: string;
}

interface EmailAnswer {
    email: string;
}

interface OwnerAnswer {
    owner: string;
}

interface SubdomainAnswer {
    subdomain: string;
}

// Interface for domain configuration from database
interface ParentDomainConfig {
    email: string;
    sslCertificate: string;
    sslCertificateKey: string;
}

/**
 * Validates domain format
 * @param domain - The domain to validate
 * @returns True if valid, error message if invalid
 */
const validateDomain = (domain: string): boolean | string => {
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,6}$/;
    return domainRegex.test(domain) ? true : 'Enter a valid domain (e.g., example.com or sub.example.com)';
};

/**
 * Validates port number
 * @param port - The port to validate
 * @returns True if valid, error message if invalid
 */
const validatePort = (port: string): boolean | string => {
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
 * Retrieves and displays the subdomains table for a given domain.
 * @param domain - The parent domain to list subdomains for.
 */
function retrieveSubdomainsTable(domain: string): Promise<SubdomainTableEntry[]> {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY);
        db.all(
            // Exclude rows where domain === subdomain (shouldn't happen, but just in case)
            'SELECT domain, target, type, subdomain FROM domains WHERE subdomain = ? ORDER BY domain',
            [domain],
            (err: Error | null, rows: SubdomainRow[]) => {
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
                    const subDomainsTable: SubdomainTableEntry[] = rows.map(row => ({
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
 * @param domain - The domain name.
 */
async function logDomainInfo(domain: string): Promise<void> {
    try {
        const subDomainsTable: SubdomainTableEntry[] = await retrieveSubdomainsTable(domain);
        if (subDomainsTable.length > 0) {
            console.table(subDomainsTable);
        } else {
            console.log(chalk.yellow('No subdomains configured for this domain.'));
        }
    } catch (err: any) {
        console.error(chalk.red('Error retrieving subdomains:'), err.message);
    }
}

// Interface for domains table entry
interface DomainTableEntry {
    Domain: string;
    Target: string;
    Type: string;
}

/**
 * Displays a table of all domains
 * @memberof module:NetGetX.Domains
 */
function domainsTable(): void {
    const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY, (err: Error | null) => {
        if (err) {
            console.log(chalk.red('Error opening database:'), err.message);
            return;
        }
    });

    db.all('SELECT domain, target, type FROM domains ORDER BY domain', [], (err: Error | null, rows: DomainTableEntry[]) => {
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
                Domain: row.Domain,
                Target: row.Target,
                Type: row.Type
            })));
        }
        db.close();
    });
}

/**
 * Adds a new domain to the configuration
 * @memberof module:NetGetX.Domains
 */
async function addNewDomain(): Promise<void> {
    while (true) {
        const description_message =
            'Add a new domain to your NetGetX configuration. You can choose to serve static content or forward traffic to a specific port on your server.\n' +
            chalk.blue('Available Service Types:\n' +
            '- Serve Static Content: Host static files (like HTML, CSS, JS, images) from a folder on your server. Great for simple websites or landing pages.\n' +
            '- Forward Port: Forward all incoming traffic to a specific port on your server. Useful for connecting your domain to a backend service, app, or container running on a different port.\n\n') +
            chalk.white('Select the type of service for this domain:');
        
        const serviceTypeAnswer: any = await inquirer.prompt([
            {
                type: 'list',
                name: 'serviceType',
                message: description_message,
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

        const type: string = serviceTypeAnswer.serviceType;

        let port: string = '';
        if (serviceTypeAnswer.serviceType === 'server') {
            const forwardPortAnswer: any = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'server',
                    message: 'Enter the forward port for this domain (type /b to go back):',
                    validate: (input: string) => {
                        if (input === '/b') return true;
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
            const staticPathAnswer: any = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'staticPath',
                    message: 'Enter the path to the static file you want to serve (type /b to go back):',
                    validate: (input: string) => input ? true : 'Static file path is required.'
                }
            ]);

            if (staticPathAnswer.staticPath === '/b') {
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
            }

            port = staticPathAnswer.staticPath;
        }

        const domainAnswer: any = await inquirer.prompt([
            {
                type: 'input',
                name: 'domain',
                message: 'Enter the new domain (e.g., example.com or sub.example.com) (type /b to go back):',
                validate: (input: string) => {
                    if (input === '/b') return true;
                    return validateDomain(input);
                }
            }
        ]);

        if (domainAnswer.domain === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const emailAnswer: any = await inquirer.prompt([
            {
                type: 'input',
                name: 'email',
                message: 'Enter the email associated with this domain (type /b to go back):',
                validate: (input: string) => {
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

        const ownerAnswer: any = await inquirer.prompt([
            {
                type: 'input',
                name: 'owner',
                message: 'Enter the owner of this domain (type /b to go back):',
                validate: (input: string) => input ? true : 'Owner is required.'
            }
        ]);

        if (ownerAnswer.owner === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const { domain, email, owner } = { ...domainAnswer, ...emailAnswer, ...ownerAnswer };

        // Verifica si el dominio ya existe en la base de datos
        const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY);
        const exists: boolean = await new Promise((resolve) => {
            db.get('SELECT 1 FROM domains WHERE domain = ? AND subdomain IS NULL', [domain], (err: Error | null, row: any) => {
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
}

/**
 * Adds a subdomain to the specified domain.
 * @memberof module:NetGetX.Domains
 * @param domain - The domain to add the subdomain to.
 * @returns Promise<void>
 */
const addSubdomain = async (domain: string): Promise<void> => {
    try {
        const subdomainAnswer: any = await inquirer.prompt([
            {
                type: 'input',
                name: 'subdomain',
                message: 'Enter the subdomain name (type /b to go back):',
                validate: (input: string) => {
                    if (input === '/b') return true;
                    if (!input) return 'Subdomain name cannot be empty.';
                    return true;
                }
            }
        ]);

        if (subdomainAnswer.subdomain === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const serviceTypeAnswer: any = await inquirer.prompt([
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

        let port: string = '';
        if (serviceTypeAnswer.serviceType === 'server') {
            const forwardPortAnswer: any = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'server',
                    message: 'Enter the forward port for this domain (type /b to go back):',
                    validate: (input: string) => input ? true : 'Forward port is required.'
                }
            ]);

            if (forwardPortAnswer.server === '/b') {
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
            }

            port = forwardPortAnswer.server;
        } else if (serviceTypeAnswer.serviceType === 'static') {
            const staticPathAnswer: any = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'staticPath',
                    message: 'Enter the path to the static file you want to serve (type /b to go back):',
                    validate: (input: string) => input ? true : 'Static file path is required.'
                }
            ]);

            if (staticPathAnswer.staticPath === '/b') {
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
            }

            port = staticPathAnswer.staticPath;
        }

        const ownerAnswer: any = await inquirer.prompt([
            {
                type: 'input',
                name: 'owner',
                message: 'Enter the owner of this subdomain (type /b to go back):',
                validate: (input: string) => input ? true : 'Owner is required.'
            }
        ]);

        if (ownerAnswer.owner === '/b') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        // Retrieve email, SSLCertificateSqlitePath, and SSLCertificateKeySqlitePath from the parent domain in the database
        let parentDomainConfig: ParentDomainConfig | null;
        try {
            const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY);
            parentDomainConfig = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT email, sslCertificate, sslCertificateKey FROM domains WHERE domain = ?',
                    [domain],
                    (err: Error | null, row: ParentDomainConfig) => {
                        db.close();
                        if (err) return reject(err);
                        resolve(row || null);
                    }
                );
            });
        } catch (err: any) {
            console.log(chalk.red('Error retrieving parent domain config:'), err.message);
            return;
        }

        if (!parentDomainConfig) {
            console.log(chalk.red(`Parent domain ${domain} not found in database.`));
            return;
        }

        try {
            await registerDomain(
                subdomainAnswer.subdomain,
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
        } catch (err: any) {
            console.log(chalk.red('Error registering subdomain:'), err.message);
            return;
        }

        console.log(chalk.green(`Subdomain ${subdomainAnswer.subdomain} added to domain ${domain}.`));
    } catch (err: any) {
        console.log(chalk.red('An error occurred while adding the subdomain:'), err.message);
        return;
    }
};

/**
 * Shows advanced settings for domains
 * @memberof module:NetGetX.Domains
 */
async function advanceSettings(): Promise<void> {
    try {
        const answers: any = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select an option:',
                choices: [
                    { name: 'Scan All SSL Certificates Issued', value: 'scan' },
                    { name: 'View Certbot Logs', value: 'logs' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        switch (answers.action) {
            case 'scan':
                await scanAndLogCertificates();
                break;
            case 'logs':
                console.log(chalk.yellow('Certbot logs soon to be implemented.'));
                break;
            case 'back':
                console.log(chalk.blue('Going back to the previous menu...'));
                return;
        }
        await advanceSettings();
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Advance Domain Menu:', error.message));
    }
}

/**
 * Links a development app project to a domain
 * @memberof module:NetGetX.Domains
 * @param domain - The domain to link the project to
 */
const linkDevelopmentAppProject = async (domain: string): Promise<void> => {
    const projectPathAnswer: any = await inquirer.prompt([
        {
            type: 'input',
            name: 'projectPath',
            message: 'Enter the path where the project is being developed:',
        }
    ]);

    try {
        // Leer la configuración del dominio desde la base de datos
        const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY);
        const domainConfig: DomainRecord | null = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM domains WHERE domain = ?', [domain], (err: Error | null, row: DomainRecord) => {
                db.close();
                if (err) return reject(err);
                resolve(row || null);
            });
        });

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} not found in database.`));
            return;
        }

        domainConfig.projectPath = projectPathAnswer.projectPath;
        // Update the domain record in the database
        const dbUpdate = new sqlite3.Database(sqliteDatabasePath);
        dbUpdate.run(
            'UPDATE domains SET projectPath = ? WHERE domain = ?',
            [domainConfig.projectPath, domain],
            (err: Error | null) => {
                if (err) {
                    console.log(chalk.red('Error updating domain with project path:'), err.message);
                }
                dbUpdate.close();
            }
        );

        console.log(chalk.yellow('Domain update in database temporarily simplified during migration.'));
        console.log(chalk.green(`Linked development app project at ${projectPathAnswer.projectPath} with domain ${domain}.`));
    } catch (error: any) {
        console.log(chalk.red('Error linking development project:'), error.message);
    }
};

/**
 * Edit or delete a subdomain for a given domain.
 * @memberof module:NetGetX.Domains
 * @param domain - The parent domain.
 * @returns Promise<void>
 */
const editOrDeleteSubdomain = async (domain: string): Promise<void> => {
    console.clear();
    try {
        // Listar subdominios asociados a este dominio
        const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY);
        const subdomains: string[] = await new Promise((resolve) => {
            db.all('SELECT domain FROM domains WHERE subdomain = ? ORDER BY domain', [domain], (err: Error | null, rows: any[]) => {
                db.close();
                resolve(rows.map(r => r.domain));
            });
        });

        if (subdomains.length === 0) {
            console.log(chalk.red('No subdomains available to edit or delete.'));
            return;
        }

        const subDomainAnswer: any = await inquirer.prompt({
            type: 'list',
            name: 'subDomain',
            message: 'Select a subdomain to edit or delete:',
            choices: [...subdomains, 'Back']
        });

        if (subDomainAnswer.subDomain === 'Back') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        const actionAnswer: any = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `What do you want to do with subdomain ${subDomainAnswer.subDomain}?`,
                choices: [
                    { name: 'Edit Subdomain', value: 'edit' },
                    { name: 'Delete Subdomain', value: 'delete' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (actionAnswer.action === 'back') {
            console.log(chalk.blue('Going back to the previous menu...'));
            return;
        }

        if (actionAnswer.action === 'edit') {
            await editDomainDetails(subDomainAnswer.subDomain);
            console.log(chalk.green(`Subdomain ${subDomainAnswer.subDomain} edited successfully.`));
        } else if (actionAnswer.action === 'delete') {
            const confirmAnswer: any = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Are you sure you want to delete the subdomain ${subDomainAnswer.subDomain}?`,
                    default: false
                }
            ]);
            
            if (!confirmAnswer.confirm) {
                console.log(chalk.blue('Subdomain deletion was cancelled.'));
                return;
            }
            
            const dbDel = new sqlite3.Database(sqliteDatabasePath);
            dbDel.run('DELETE FROM domains WHERE domain = ? AND subdomain = ?', [subDomainAnswer.subDomain, domain], (err: Error | null) => {
                if (err) {
                    console.log(chalk.red('Error deleting subdomain:'), err.message);
                } else {
                    console.log(chalk.green(`Subdomain ${subDomainAnswer.subDomain} deleted successfully.`));
                }
                dbDel.close();
            });
        }
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Edit/Delete Subdomain Menu:', error.message));
    }
};

/**
 * Edit domain details like type and target
 * @memberof module:NetGetX.Domains
 * @param domain - The domain to edit
 * @returns Promise<void>
 */
const editDomainDetails = async (domain: string): Promise<void> => {
    const editOptions: any = await inquirer.prompt([
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
            const typeAnswer: any = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'newType',
                    message: 'Select the new type for this domain:',
                    choices: [
                        { name: 'Serve Static Content', value: 'static' },
                        { name: 'Forward Port', value: 'server' }
                    ]
                }
            ]);
            await updateDomainType(domain, typeAnswer.newType);
            console.log(chalk.green(`Domain type updated to ${typeAnswer.newType}`));
            break;

        case 'editTarget':
            const targetAnswer: any = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'newTarget',
                    message: 'Enter the new target (port number or file path):',
                    validate: (input: string) => input ? true : 'Target is required.'
                }
            ]);
            await updateDomainTarget(domain, targetAnswer.newTarget);
            console.log(chalk.green(`Domain target updated to ${targetAnswer.newTarget}`));
            break;

        case 'back':
            return;
    }
};

/**
 * Edits or deletes a domain from the database.
 * @memberof module:NetGetX.Domains
 * @param domain - The domain to edit or delete.
 * @returns Promise<void>
 */
const editOrDeleteDomain = async (domain: string): Promise<void> => {
    console.clear();
    try {
        // Leer la configuración del dominio desde la base de datos
        const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY);
        const domainConfig: DomainRecord | null = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM domains WHERE domain = ?', [domain], (err: Error | null, row: DomainRecord) => {
                db.close();
                if (err) return reject(err);
                resolve(row || null);
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

        const answer: any = await inquirer.prompt([
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
                const confirmDelete: any = await inquirer.prompt([
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
                const dbDel = new sqlite3.Database(sqliteDatabasePath);
                dbDel.run('DELETE FROM domains WHERE domain = ? OR subdomain = ?', [domain, domain], (err: Error | null) => {
                    if (err) {
                        console.log(chalk.red('Error deleting domain:'), err.message);
                    } else {
                        console.log(chalk.green(`Domain ${domain} and its subdomains deleted successfully.`));
                    }
                    dbDel.close();
                });
                return await domainsMenu();
            case 'back':
                return;
        }

        // After an action, redisplay the menu
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
    advanceSettings 
};