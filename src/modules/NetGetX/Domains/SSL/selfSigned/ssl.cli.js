import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import checkAndInstallCertbot from '../Certbot/checkAndInstallCertbot.js';
import { 
    verifySSLCertificate, 
    renewSSLCertificate, 
    obtainSSLCertificates,
    checkCertificates 
} from '../SSLCertificates.js';
import printCertbotLogs from '../Certbot/certbot.js';
import { storeConfigInDB, updateSSLCertificatePaths } from '../../../../../sqlite/utils_sqlite3.js';
import sqlite3 from 'sqlite3';

/**
 * Display the current SSL Configuration for a domain
  * @memberof module:NetGetX.SSL
 * @param {Object} domainConfig - The domain configuration object
 * @param {string} domain - The domain name
 * @returns {void}
 */
const displayCurrentSSLConfiguration = (domainConfig, domain) => {
    console.log('\nCurrent SSL Configuration:');
    console.log(`
███████ ███████ ██ .domain: ${chalk.green(domain)}  
██      ██      ██ .email: ${chalk.green(domainConfig.email)} 
███████ ███████ ██ .SSL Mode: ${chalk.green(domainConfig.sslMode || 'Not Set')}
     ██      ██ ██ .SSLCertificatesPath: ${chalk.green(domainConfig.SSLCertificatesPath)}
███████ ███████ ███████ .SSLCertificatesKeyPath: ${chalk.green(domainConfig.SSLCertificateKeyPath)}`);
};

/**
 * Check if a wildcard certificate exists for a domain
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain name
 * @returns {string} - The path to the wildcard certificate if it exists
 */
const checkWildcardCertificate = (domain) => {
    const rootDomain = domain.split('.').slice(1).join('.');
    const wildcardDomain = `*.${rootDomain}`;
    const certPath = `/etc/letsencrypt/live/${wildcardDomain}/fullchain.pem`;
    return fs.existsSync(certPath) ? certPath : null;
};

/**
 * Domain SSL Configuration Menu
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain name
 * @returns {void}
 */
const domainSSLConfiguration = async (domain) => {
    try {
        // Check and install Certbot before proceeding with SSL Configuration
        const certbotInstalled = await checkAndInstallCertbot();
        if (!certbotInstalled) {
            console.log(chalk.red('Certbot installation failed. Cannot proceed with SSL configuration.'));
            return;
        }

        // Leer configuración del dominio desde la base de datos
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

        // Check if a wildcard certificate exists for the parent domain
        const wildcardCertPath = checkWildcardCertificate(domain);

        if (wildcardCertPath) {
            const { useWildcard } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'useWildcard',
                    message: `A wildcard certificate for ${wildcardCertPath} was found. Do you want to use this wildcard certificate for ${domain}?`,
                    default: true
                }
            ]);

            if (useWildcard) {
                domainConfig.SSLCertificatesPath = wildcardCertPath;
                domainConfig.SSLCertificateKeyPath = wildcardCertPath.replace('fullchain.pem', 'privkey.pem');
                // Aquí podrías actualizar la base de datos si lo deseas
                console.log(chalk.green(`Applied wildcard certificate from ${wildcardCertPath} to ${domain}.`));
            } else {
                console.log(chalk.yellow(`Proceeding to issue a new certificate for ${domain}.`));
                await issueCertificateForDomain(domain, domainConfig);
            }
        } else {
            await issueCertificateForDomain(domain, domainConfig);
        }

        // After an action, redisplay the menu
        await displayCurrentSSLConfiguration(domainConfig, domain);
    } catch (error) {
        console.error(chalk.red('An error occurred in the SSL Configuration Menu:', error.message));
    }
};

/**
 * Issue SSL Certificates for a domain
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain name
 * @param {Object} domainConfig - The domain configuration object
 * @returns {void}
 */   
async function issueCertificateForDomain(domain, domainConfig) {
    const certificatesIssued = await checkCertificates(domain);

    if (certificatesIssued) {
        if (!domainConfig.SSLCertificatesPath || !domainConfig.SSLCertificateKeyPath) {
            domainConfig.SSLCertificateName = `${domain}`;
            domainConfig.SSLCertificatesPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
            domainConfig.SSLCertificateKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;

            await updateSSLCertificatePaths(domain, domainConfig.SSLCertificatesPath, domainConfig.SSLCertificateKeyPath);
        }

        displayCurrentSSLConfiguration(domainConfig, domain);

        const options = [
            { name: 'Verify SSL Certificate', value: 'verifyCertificate' },
            { name: 'Renew SSL Certificate', value: 'renewCertificate' },
            { name: 'View Certbot Logs', value: 'viewLogs' },
            { name: 'Back to Domains Menu', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select an SSL Configuration option:',
                choices: options
            }
        ]);

        switch (answer.action) {
            case 'verifyCertificate':
                await verifySSLCertificate(domain);
                break;
            case 'renewCertificate':
                await renewSSLCertificate(domain);
                break;
            case 'viewLogs':
                await printCertbotLogs();
                break;
            case 'editSSLMethod':
                // Eliminar el método SSL en la base de datos (opcional)
                const db = new sqlite3.Database('/opt/.get/domains.db');
                db.run(
                    `UPDATE domains SET sslMode = NULL WHERE domain = ?`,
                    [domain],
                    (err) => {
                        if (err) {
                            console.log(chalk.red('Error resetting SSL mode in database:'), err.message);
                        } else {
                            console.log(chalk.green('SSL Configuration method has been reset.'));
                        }
                        db.close();
                    }
                );
                break;
            case 'back':
                return;
            case 'exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit();
            default:
                console.log(chalk.red('Invalid selection. Please try again.'));
        }
    } else {
        console.log(chalk.yellow(`No certificates found for ${domain}.`));
        const { issueCertificates } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'issueCertificates',
                message: `No certificates found for ${domain}. Would you like to issue certificates?`,
                default: true
            }
        ]);

        if (issueCertificates) {
            await obtainSSLCertificates(domain, domainConfig.email);
            domainConfig.SSLCertificatesPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
            domainConfig.SSLCertificateKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;

            // Guardar los cambios en la base de datos en vez de xConfig
            const db = new sqlite3.Database('/opt/.get/domains.db');
            db.run(
                `UPDATE domains SET 
                    sslCertificate = ?,
                    sslCertificateKey = ?,
                 WHERE domain = ?`,
                [
                    domainConfig.SSLCertificatesPath,
                    domainConfig.SSLCertificateKeyPath,
                    domain
                ],
                (err) => {
                    if (err) {
                        console.log(chalk.red('Error updating SSL certificate paths in database:'), err.message);
                    }
                    db.close();
                }
            );
            await storeConfigInDB(domain, 'letsencrypt', domainConfig.SSLCertificateSqlitePath, domainConfig.SSLCertificateKeySqlitePath, domainConfig.target, domainConfig.type, domainConfig.projectPath);
        }
    }
}

export default domainSSLConfiguration;
