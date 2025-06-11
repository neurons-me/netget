//netget/src/modules/NetGetX/Domains/domains.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadOrCreateXConfig } from '../config/xConfig.js';
import selectedDomainMenu from './selectedDomain.cli.js';
import { addNewDomain, advanceSettings, domainsTable } from './domainsOptions.js';
import sqlite3 from 'sqlite3';

/**
 * Obtiene los dominios de la base de datos SQLite3.
 * @returns {Promise<Array>} Promesa que se resuelve con la lista de dominios.
 */
const getDomainsFromDB = () => {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(err);
        });

        db.all(`SELECT domain, subdomain FROM domains ORDER BY domain`, [], (err, rows) => {
            if (err) {
            db.close();
            return reject(err);
            }

            const rootDomains = {};  // { 'example.com': ['api.example.com', 'www.example.com'] }

            rows.forEach(row => {
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
            const formattedDomains = Object.entries(rootDomains)
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
const domainsMenu = async () => {
    try {
        console.clear();
        console.log(chalk.blue('Domains Routed via NetGet'));
        const dbDomains = await getDomainsFromDB();

        if (dbDomains.length === 0) {
            console.log(chalk.yellow('No domains configured.'));
            console.log(
                chalk.yellow(
                    'Once you have domains configured, they will appear below as a selectable list and be ready to serve.\n' +
                    'You can then choose a domain to view or modify its settings.'
                )
            );            
        }

        const options = [
            new inquirer.Separator(),
            ...(await getDomainsFromDB()),
            new inquirer.Separator(),
            { name: 'Add New Domain', value: 'addNewDomain' },
            { name: 'View Full Table Domains', value: 'viewAllDomains' },
            { name: 'Advance Domain Settings', value: 'advance' },
            { name: 'Back', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer = await inquirer.prompt([
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
                process.exit();
            default:
                const domain = answer.action;
                await selectedDomainMenu(domain);
        }

        // After an action, redisplay the menu
        await domainsMenu();
    } catch (error) {
        console.error(chalk.red('An error occurred in the Domains Menu:', error.message));
    }
};

export default domainsMenu;
