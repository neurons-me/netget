//netget/src/modules/NetGetX/Domains/domains.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import selectedDomainMenu from './selectedDomain.cli.ts';
import { isReservedLocalDomain } from './reservedDomains.ts';
import { addNewDomain, advanceSettings, domainsTable } from './domainsOptions.ts';
import sqlite3 from 'sqlite3';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';
import path from 'path';

const xConfig = getNetgetDataDir();
const sqliteDatabasePath: string = path.join(xConfig, 'domains.db');
// console.log(chalk.gray(`Using SQLite DB at: ${sqliteDatabasePath}`));

// Interface for domain row from database
interface DomainRow {
    domain: string;
    subdomain: string | null;
}

// Interface for formatted domain entries
interface FormattedDomain {
    name: string;
    value: string;
}

// Interface for root domains structure
interface RootDomains {
    [key: string]: string[];
}

// Interface for menu answers
interface DomainMenuAnswers {
    action: string;
}

/**
 * Obtiene los dominios de la base de datos SQLite3.
 * @returns Promesa que se resuelve con la lista de dominios.
 */
const getDomainsFromDB = (): Promise<FormattedDomain[]> => {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(sqliteDatabasePath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(err);
        });

        db.all(`SELECT domain, subdomain FROM domains ORDER BY domain`, [], (err: Error | null, rows: DomainRow[]) => {
            if (err) {
                db.close();
                return reject(err);
            }

            const rootDomains: RootDomains = {};  // { 'example.com': ['api.example.com', 'www.example.com'] }

            rows.forEach((row: DomainRow) => {
                if (row.subdomain === row.domain) {
                    if (!rootDomains[row.domain]) {
                        rootDomains[row.domain] = [];
                    }
                    // Do not add as subdomain to itself
                    return;
                }
                
                if (row.subdomain === null) {
                    // Dominio raíz
                    if (!rootDomains[row.domain]) {
                        rootDomains[row.domain] = [];
                    }
                } else {
                    // Subdominio
                    if (!rootDomains[row.subdomain]) {
                        rootDomains[row.subdomain] = [];
                    }
                    rootDomains[row.subdomain].push(row.domain);
                }
            });

            // Ordenar los dominios alfabéticamente antes de formatear
            const formattedDomains: FormattedDomain[] = Object.entries(rootDomains)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([domain, subDomains]) => ({
                    name: `${domain} ${subDomains.length > 0 ? `(${subDomains.join(', ')})` : ''}`,
                    value: domain
                }));

            db.close();
            resolve(formattedDomains);
        });
    });
};

/**
 * Displays the Domains Menu.
 * @memberof module:NetGetX.Domains
 */
const domainsMenu = async (): Promise<void> => {
    try {
        console.clear();
        console.log(chalk.bold('📍 .Get Local > Main Server > Domains & Certificates'));
        console.log(chalk.gray('Domain registry: ownership, email, SSL mode, certificates, and subdomains.'));
        console.log(chalk.gray('A domain can live here without being active in the Routing table.'));
        console.log(chalk.gray('local.netget is the reserved Local gateway and is managed from Main Server, not here.\n'));

        const dbDomains: FormattedDomain[] = await getDomainsFromDB();
        const registeredDomains = dbDomains.filter((domain) => !isReservedLocalDomain(domain.value));

        if (registeredDomains.length === 0) {
            console.log(chalk.yellow('No domains registered.'));
            console.log(
                chalk.yellow(
                    'Add domains here first, then activate only the ones you want from the Routing table.'
                )
            );
            console.log('');
        }

        const options: Array<any> = [
            ...(registeredDomains.length > 0 ? [...registeredDomains, new inquirer.Separator()] : []),
            { name: 'Add domain', value: 'addNewDomain' },
            { name: 'View domain registry', value: 'viewAllDomains' },
            { name: 'Advanced certificate settings', value: 'advance' },
            { name: 'Back', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer: DomainMenuAnswers = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select a domain or add one:',
                pageSize: 10,
                choices: options
            }
        ]);

        switch (answer.action) {
            case 'addNewDomain':
                await addNewDomain();
                break;
            case 'viewAllDomains':
                console.clear();
                console.log(chalk.blue('All Configured Domains:'));
                domainsTable();
                break;
            case 'advance':
                console.clear();
                await advanceSettings();
                break;
            case 'back':
                console.clear();
                return;
            case 'exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit(0);
                break;
            default:
                const domain: string = answer.action;
                if (isReservedLocalDomain(domain)) break;
                await selectedDomainMenu(domain);
        }

        // After an action, redisplay the menu
        await domainsMenu();
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Domains Menu:', error.message));
    }
};

export default domainsMenu;
