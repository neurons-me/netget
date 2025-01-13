import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import { loadOrCreateXConfig, saveXConfig } from '../../config/xConfig.js';
import checkAndInstallCertbot from './Certbot/checkAndInstallCertbot.js';
import { 
    verifySSLCertificate, 
    renewSSLCertificate, 
    obtainSSLCertificates,
    checkCertificates 
} from './SSLCertificates.js';
import printCertbotLogs from './Certbot/certbot.js';
import { storeConfigInDB } from '../../../../sqlite/utils_sqlite3.js';

const displayCurrentSSLConfiguration = (domainConfig, domain) => {
    console.log('\nCurrent SSL Configuration:');
    console.log(`
███████ ███████ ██ .domain: ${chalk.green(domain)}  
██      ██      ██ .email: ${chalk.green(domainConfig.email)} 
███████ ███████ ██ .enforceHttps: ${chalk.green(domainConfig.enforceHttps)}
     ██      ██ ██ .SSLCertificatesPath: ${chalk.green(domainConfig.SSLCertificatesPath)}
███████ ███████ ███████ .SSLCertificatesPath: ${chalk.green(domainConfig.SSLCertificatesPath)}
.SSL Verification: ${chalk.green("Good/Bad")}`);
};

const checkWildcardCertificate = (domain) => {
    const rootDomain = domain.split('.').slice(1).join('.');
    const wildcardDomain = `*.${rootDomain}`;
    const certPath = `/etc/letsencrypt/live/${wildcardDomain}/fullchain.pem`;
    return fs.existsSync(certPath) ? certPath : null;
};

const domainSSLConfiguration = async (domain) => {
    try {
        // Check and install Certbot before proceeding with SSL Configuration
        const certbotInstalled = await checkAndInstallCertbot();
        if (!certbotInstalled) {
            console.log(chalk.red('Certbot installation failed. Cannot proceed with SSL configuration.'));
            return;
        }

        const xConfig = await loadOrCreateXConfig();
        const domainConfig = xConfig.domains[domain];

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found.`));
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
                const xConfig = await loadOrCreateXConfig();
                xConfig.domains[domain] = domainConfig;
                await saveXConfig({ domains: xConfig.domains });
                console.log(chalk.green(`Applied wildcard certificate from ${wildcardCertPath} to ${domain}.`));
            } else {
                console.log(chalk.yellow(`Proceeding to issue a new certificate for ${domain}.`));
                await issueCertificateForDomain(domain, domainConfig);
            }
        } else {
            await issueCertificateForDomain(domain, domainConfig);
        }

        // After an action, redisplay the menu
        await displayCurrentSSLConfiguration(domain);
    } catch (error) {
        console.error(chalk.red('An error occurred in the SSL Configuration Menu:', error.message));
    }
};

const issueCertificateForDomain = async (domain, domainConfig) => {
    const certificatesIssued = await checkCertificates(domain);

    if (certificatesIssued) {
        if (!domainConfig.SSLCertificatesPath || !domainConfig.SSLCertificateKeyPath) {
            domainConfig.SSLCertificateName = `${domain}`;
            domainConfig.SSLCertificatesPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
            domainConfig.SSLCertificateKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
            domainConfig.SSLCertificateSqlitePath = `/etc/letsencrypt/archive/${domain}/fullchain1.pem`;
            domainConfig.SSLCertificateKeySqlitePath = `/etc/letsencrypt/archive/${domain}/privkey1.pem`;   
            const xConfig = await loadOrCreateXConfig();
            xConfig.domains[domain] = domainConfig;
            await saveXConfig({ domains: xConfig.domains });
            await storeConfigInDB(domain, 'letsencrypt', domainConfig.SSLCertificateSqlitePath, domainConfig.SSLCertificateKeySqlitePath, domainConfig.target, domainConfig.type, domainConfig.projectPath);
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
                await saveXConfig({ domain, sslMode: null });
                console.log(chalk.green('SSL Configuration method has been reset.'));
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
            domainConfig.SSLCertificateSqlitePath = `/etc/letsencrypt/archive/${domain}/fullchain1.pem`;
            domainConfig.SSLCertificateKeySqlitePath = `/etc/letsencrypt/archive/${domain}/privkey1.pem`; 
            const xConfig = await loadOrCreateXConfig();
            xConfig.domains[domain] = domainConfig;
            await saveXConfig({ domains: xConfig.domains });
            await storeConfigInDB(domain, 'letsencrypt', domainConfig.SSLCertificateSqlitePath, domainConfig.SSLCertificateKeySqlitePath, domainConfig.target, domainConfig.type, domainConfig.projectPath);
        }
    }
};

export default domainSSLConfiguration;
