import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import checkAndInstallCertbot from '../Certbot/checkAndInstallCertbot.ts';
import { 
    checkCertificateExists 
} from '../SSLCertificates.ts';
import printCertbotLogs from '../Certbot/certbot.ts';
import { storeConfigInDB, updateSSLCertificatePaths } from '../../../../../sqlite/utils_sqlite3.ts';
import sqlite3 from 'sqlite3';

// Type definitions
interface DomainConfig {
    domain: string;
    email: string;
    sslMode?: string;
    SSLCertificatesPath?: string;
    SSLCertificateKeyPath?: string;
    SSLCertificateName?: string;
    SSLCertificateSqlitePath?: string;
    SSLCertificateKeySqlitePath?: string;
    target?: string;
    type?: string;
    projectPath?: string;
}

interface InquirerAnswer {
    action: string;
}

interface WildcardConfirmation {
    useWildcard: boolean;
}

interface CertificateIssuance {
    issueCertificates: boolean;
}

/**
 * Display the current SSL Configuration for a domain
 * @memberof module:NetGetX.SSL
 * @param {DomainConfig} domainConfig - The domain configuration object
 * @param {string} domain - The domain name
 * @returns {void}
 */
const displayCurrentSSLConfiguration = (domainConfig: DomainConfig, domain: string): void => {
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
 * @returns {string | null} - The path to the wildcard certificate if it exists
 */
const checkWildcardCertificate = (domain: string): string | null => {
    const rootDomain = domain.split('.').slice(1).join('.');
    const wildcardDomain = `*.${rootDomain}`;
    const certPath = `/etc/letsencrypt/live/${wildcardDomain}/fullchain.pem`;
    return fs.existsSync(certPath) ? certPath : null;
};

/**
 * Domain SSL Configuration Menu
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain name
 * @returns {Promise<void>}
 */
const domainSSLConfiguration = async (domain: string): Promise<void> => {
    try {
        // Check and install Certbot before proceeding with SSL Configuration
        const certbotInstalled: boolean = await checkAndInstallCertbot();
        if (!certbotInstalled) {
            console.log(chalk.red('Certbot installation failed. Cannot proceed with SSL configuration.'));
            return;
        }

        // Leer configuración del dominio desde la base de datos
        const db = new sqlite3.Database('/opt/.get/domains.db', sqlite3.OPEN_READONLY);
        const domainConfig: DomainConfig | null = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM domains WHERE domain = ?', [domain], (err: Error | null, row: DomainConfig) => {
                db.close();
                if (err) return reject(err);
                resolve(row || null);
            });
        });

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found in database.`));
            return;
        }

        // Check if a wildcard certificate exists for the parent domain
        const wildcardCertPath: string | null = checkWildcardCertificate(domain);

        if (wildcardCertPath) {
            const { useWildcard }: WildcardConfirmation = await inquirer.prompt([
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(chalk.red('An error occurred in the SSL Configuration Menu:', errorMessage));
    }
};

/**
 * Issue SSL Certificates for a domain
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain name
 * @param {DomainConfig} domainConfig - The domain configuration object
 * @returns {Promise<void>}
 */   
async function issueCertificateForDomain(domain: string, domainConfig: DomainConfig): Promise<void> {
    const certificatesIssued: boolean = await checkCertificateExists(domain);

    if (certificatesIssued) {
        if (!domainConfig.SSLCertificatesPath || !domainConfig.SSLCertificateKeyPath) {
            domainConfig.SSLCertificateName = `${domain}`;
            domainConfig.SSLCertificatesPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
            domainConfig.SSLCertificateKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;

            await updateSSLCertificatePaths(domain, domainConfig.SSLCertificatesPath, domainConfig.SSLCertificateKeyPath);
        }

        displayCurrentSSLConfiguration(domainConfig, domain);

        const options = [
            { name: 'View Certbot Logs', value: 'viewLogs' },
            { name: 'Back to Domains Menu', value: 'back' },
            { name: 'Exit', value: 'exit' }
        ];

        const answer: InquirerAnswer = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Select an SSL Configuration option:',
                choices: options
            }
        ]);

        switch (answer.action) {
            case 'viewLogs':
                await printCertbotLogs();
                break;
            case 'editSSLMethod':
                // Eliminar el método SSL en la base de datos (opcional)
                const db = new sqlite3.Database('/opt/.get/domains.db');
                db.run(
                    `UPDATE domains SET sslMode = NULL WHERE domain = ?`,
                    [domain],
                    (err: Error | null) => {
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
        const { issueCertificates }: CertificateIssuance = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'issueCertificates',
                message: `No certificates found for ${domain}. Would you like to issue certificates?`,
                default: true
            }
        ]);

        if (issueCertificates) {
            // Simplified certificate issuance - temporarily simplified during migration
            console.log(chalk.yellow(`Certificate issuance for ${domain} would be executed here.`));
            console.log(chalk.blue('Full SSL certificate automation will be available after complete migration.'));
            
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
                (err: Error | null) => {
                    if (err) {
                        console.log(chalk.red('Error updating SSL certificate paths in database:'), err.message);
                    }
                    db.close();
                }
            );
            await storeConfigInDB(
                domain, 
                'letsencrypt', 
                domainConfig.SSLCertificateSqlitePath || '', 
                domainConfig.SSLCertificateKeySqlitePath || '', 
                domainConfig.target || '', 
                domainConfig.type || '', 
                domainConfig.projectPath || ''
            );
        }
    }
}

export default domainSSLConfiguration;