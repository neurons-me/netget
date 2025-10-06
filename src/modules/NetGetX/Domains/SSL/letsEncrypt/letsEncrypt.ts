//netget/src/modules/NetGetX/Domains/SSL/letsEncrypt/letsEncrypt.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { exec } from 'child_process';
import { loadOrCreateXConfig, saveXConfig, XConfig } from '../../../config/xConfig.js';
import checkAndInstallCertbot from '../Certbot/checkAndInstallCertbot.js';
// import { obtainSSLCertificates } from '../Certbot/SSLCertificatesHandler.js'; // Temporarily disabled - needs migration

// Interface for domain and email input
interface DomainEmailInput {
    domain: string;
    email: string;
}

// Interface for continue confirmation
interface ContinueConfirmation {
    continue: boolean;
}

// Interface for retry confirmation
interface RetryConfirmation {
    retry: boolean;
}

// Interface for SSL configuration update
interface SSLConfigUpdate {
    sslMode: string;
    email: string;
    SSLCertificatesPath: string;
    SSLCertificateKeyPath: string;
}

/**
 * Verify DNS record for domain.
 * @memberof module:NetGetX.SSL
 * @param domain - Domain name.
 * @returns Promise resolving to true if DNS record is verified successfully, false otherwise.
 */
const verifyDNSRecord = async (domain: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        const command: string = `nslookup -q=txt _acme-challenge.${domain}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to verify DNS record: ${error.message}`));
                reject(error);
                return;
            }
            if (stdout.includes('NXDOMAIN')) {
                console.error(chalk.red(`DNS record not found for _acme-challenge.${domain}`));
                reject(new Error(`DNS record not found for _acme-challenge.${domain}`));
                return;
            }
            console.log(chalk.green(`DNS record found for _acme-challenge.${domain}`));
            resolve(true);
        });
    });
};

/**
 * Setup LetsEncrypt SSL for domain.
 * @memberof module:NetGetX.SSL
 * @param xConfiguration - X-Configuration object.
 * @returns Promise resolving when SSL setup is complete.
 */
const letsEncryptMethod = async (xConfiguration: any): Promise<void> => {
    try {
        const answers: DomainEmailInput = await inquirer.prompt([
            {
                type: 'input',
                name: 'domain',
                message: 'Please enter your domain:',
                validate: (input: string) => input ? true : 'Domain is required.'
            },
            {
                type: 'input',
                name: 'email',
                message: 'Please enter your email:',
                validate: (input: string) => input ? true : 'Email is required.'
            }
        ]);
        
        const { domain, email } = answers;
        
        console.log(chalk.green(`Setting up LetsEncrypt SSL for domain ${domain} with email ${email}...`));
        
        //const xConfig = await loadOrCreateXConfig();
        //// Save initial configuration
        //const initial_SSL = {
        //    sslMode: 'letsencrypt',
        //    email,
        //    domain
        //};
//
        //xConfig.domains[domain] = initial_SSL;
        //await saveXConfig({ domains: xConfig.domains });

        await checkAndInstallCertbot();
        console.log(chalk.green('Certbot and NGINX plugin are ready.'));
        console.log(chalk.green('Using DNS-01 challenge for wildcard certificate...'));

        console.log(chalk.yellow('Please deploy DNS TXT records as requested by Certbot.'));
        console.log(chalk.yellow('SSL certificate obtaining temporarily simplified during TypeScript migration'));
        // await obtainSSLCertificates(domain, email);

        console.log(chalk.green('Verifying DNS record...'));
        await verifyDNSRecord(domain);

        const SSLPath: string = `/etc/letsencrypt/live/${domain}`;
        const SSlUpdate: SSLConfigUpdate = {
            sslMode: 'letsencrypt',
            email,
            SSLCertificatesPath: `${SSLPath}/fullchain.pem`,
            SSLCertificateKeyPath: `${SSLPath}/privkey.pem`
        };

        const xConfig: XConfig = await loadOrCreateXConfig();
        if (xConfig.domains) {
            delete xConfig.domains[domain];
            console.log(xConfig.domains);
            xConfig.domains[domain] = SSlUpdate as any;
            await saveXConfig({ domains: xConfig.domains });
        }

        console.log(chalk.green('SSL configuration updated successfully.'));
        await inquirer.prompt([
            {
                type: 'confirm',
                name: 'continue',
                message: 'SSL setup is complete. Select Continue to return to the main menu.',
                default: true
            }
        ]);
    } catch (error: any) {
        console.error(chalk.red('An error occurred during the LetsEncrypt setup process:', error.message));

        // Retry option in case of failure
        const retryAnswers: RetryConfirmation = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'retry',
                message: 'DNS verification failed. Do you want to retry the verification process?',
                default: true
            }
        ]);

        if (retryAnswers.retry) {
            try {
                console.log(chalk.green('Retrying DNS verification...'));
                await verifyDNSRecord(xConfiguration.domain);
                console.log(chalk.green('DNS record verified successfully.'));
            } catch (retryError: any) {
                console.error(chalk.red('Retry failed:', retryError.message));
            }
        }
    }
};

export default letsEncryptMethod;