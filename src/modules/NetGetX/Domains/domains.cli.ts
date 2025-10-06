//netget/src/modules/NetGetX/Domains/domains.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import selectedDomainMenu from './selectedDomain.cli.ts';
import { addNewDomain, advanceSettings, domainsTable } from './domainsOptions.ts';
import sqlite3 from 'sqlite3';

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
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY, (err) => {
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
        console.log(chalk.blue('Domains Routed via NetGet'));
        const dbDomains: FormattedDomain[] = await getDomainsFromDB();

        if (dbDomains.length === 0) {
            console.log(chalk.yellow('No domains configured.'));
            console.log(
                chalk.yellow(
                    'Once you have domains configured, they will appear below as a selectable list and be ready to serve.\n' +
                    'You can then choose a domain to view or modify its settings.'
                )
            );            
        }

        const options: Array<any> = [
            new inquirer.Separator(),
            ...(await getDomainsFromDB()),
            new inquirer.Separator(),
            { name: 'Add New Domain', value: 'addNewDomain' },
            { name: 'View Full Table Domains', value: 'viewAllDomains' },
            { name: 'Advance Domain Settings', value: 'advance' },
            { name: 'Back', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer: DomainMenuAnswers = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select a domain or add a new one:',
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
                await selectedDomainMenu(domain);
        }

        // After an action, redisplay the menu
        await domainsMenu();
    } catch (error: any) {
        console.error(chalk.red('An error occurred in the Domains Menu:', error.message));
    }
};

export default domainsMenu;