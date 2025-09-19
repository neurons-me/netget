import inquirer from 'inquirer';
import chalk from 'chalk';
import { editOrDeleteDomain, logDomainInfo, addSubdomain, editOrDeleteSubdomain } from './domainsOptions.js';
import domainSSLConfiguration from './SSL/selfSigned/ssl.cli.js';
import sqlite3 from 'sqlite3';

/**
 * Domain Menu once a domain is selected
 * @memberof NetGetX.Domains
 * @param {string} domain - The domain to display the menu
 * @returns {Promise<void>} - A promise that resolves when the menu is completed
 */
async function selectedDomainMenu(domain) {
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

        await logDomainInfo(domain);

        const options = [
            { name: 'Add Subdomain', value: 'addSubdomain' },
            { name: 'Edit/Delete Domain', value: 'editOrDelete' },
            { name: 'Edit/Delete Subdomain', value: 'editOrDeleteSubdomain' },
            { name: 'SSL Configuration', value: 'sslConfig' },
            // { name: 'Link Development App Project', value: 'linkDevApp' },
            { name: 'Back to Domains Menu', value: 'back' },
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
            // case 'linkDevApp':
            //     await linkDevelopmentAppProject(domain);
            //     break;
            case 'back':
                return;
            default:
                console.log(chalk.red('Invalid selection. Please try again.'));
        }

        // After an action, redisplay the menu
        await selectedDomainMenu(domain);
    } catch (error) {
        console.error(chalk.red('An error occurred in the Selected Domain Menu:', error.message));
    }
}

export default selectedDomainMenu;
