//netget/src/modules/NetGetX/Domains/SSL/letsEncrypt/letsEncrypt.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { promisify } from 'util';
import { exec } from 'child_process';
import { loadXConfig, saveXConfig, XConfig } from '../../../config/xConfig.js';
import checkAndInstallCertbot from '../Certbot/checkAndInstallCertbot.js';

const execAsync = promisify(exec); 

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

// Interface for X-Configuration
interface XConfiguration {
    domain?: string;
    [key: string]: any;
}

/**
 * Obtain SSL certificates using Certbot.
 * @param domain - Domain name.
 * @param email - Email address.
 * @returns Promise resolving when certificates are obtained.
 */
const obtainSSLCertificates = async (domain: string, email: string): Promise<void> => {
    try {
        console.log(chalk.blue(`Obtaining SSL certificates for ${domain}...`));
        const command = `sudo certbot certonly --manual --preferred-challenges dns --email ${email} --agree-tos --no-eff-email -d ${domain} -d *.${domain}`;
        
        console.log(chalk.yellow('Running Certbot command:'));
        console.log(chalk.cyan(command));
        console.log(chalk.yellow('\nPlease follow Certbot instructions to create DNS TXT records.'));
        
        const { stdout, stderr } = await execAsync(command);
        
        if (stderr && !stderr.includes('Saving debug log')) {
            console.warn(chalk.yellow(`Certbot warnings: ${stderr}`));
        }
        
        console.log(chalk.green('SSL certificates obtained successfully!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Failed to obtain SSL certificates: ${errorMessage}`));
        throw error;
    }
};

/**
 * Verify DNS record for domain.
 * @memberof module:NetGetX.SSL
 * @param domain - Domain name.
 * @returns Promise resolving to true if DNS record is verified successfully, false otherwise.
 */
const verifyDNSRecord = async (domain: string): Promise<boolean> => {
    try {
        const command = `nslookup -q=txt _acme-challenge.${domain}`;
        const { stdout, stderr } = await execAsync(command);
        
        if (stdout.includes('NXDOMAIN')) {
            const errorMsg = `DNS record not found for _acme-challenge.${domain}`;
            console.error(chalk.red(errorMsg));
            throw new Error(errorMsg);
        }
        
        console.log(chalk.green(`DNS record found for _acme-challenge.${domain}`));
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Failed to verify DNS record: ${errorMessage}`));
        throw error;
    }
};

/**
 * Setup LetsEncrypt SSL for domain.
 * @memberof module:NetGetX.SSL
 * @param xConfiguration - X-Configuration object.
 * @returns Promise resolving when SSL setup is complete.
 */
const letsEncryptMethod = async (xConfiguration?: XConfiguration): Promise<void> => {
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
        
        // Load configuration and save initial SSL setup
        const xConfig = await loadXConfig();
        
        // Initialize domains object if it doesn't exist
        if (!xConfig.domains) {
            xConfig.domains = {};
        }
        
        // Save initial configuration
        const initialSSL = {
            sslMode: 'letsencrypt',
            email,
            domain
        };

        xConfig.domains[domain] = initialSSL as any;
        await saveXConfig({ domains: xConfig.domains });
        console.log(chalk.blue('Initial SSL configuration saved.'));

        // Check and install Certbot if needed
        await checkAndInstallCertbot();
        console.log(chalk.green('Certbot and NGINX plugin are ready.'));
        console.log(chalk.green('Using DNS-01 challenge for wildcard certificate...'));

        // Obtain SSL certificates
        console.log(chalk.yellow('Please deploy DNS TXT records as requested by Certbot.'));
        await obtainSSLCertificates(domain, email);

        // Verify DNS record
        console.log(chalk.green('Verifying DNS record...'));
        await verifyDNSRecord(domain);

        // Update configuration with certificate paths
        const SSLPath = `/etc/letsencrypt/live/${domain}`;
        const SSLUpdate: SSLConfigUpdate = {
            sslMode: 'letsencrypt',
            email,
            SSLCertificatesPath: `${SSLPath}/fullchain.pem`,
            SSLCertificateKeyPath: `${SSLPath}/privkey.pem`
        };

        const updatedConfig = await loadXConfig();
        if (updatedConfig.domains) {
            updatedConfig.domains[domain] = SSLUpdate as any;
            await saveXConfig({ domains: updatedConfig.domains });
        }

        console.log(chalk.green('SSL configuration updated successfully.'));
        
        await inquirer.prompt<ContinueConfirmation>([
            {
                type: 'confirm',
                name: 'continue',
                message: 'SSL setup is complete. Select Continue to return to the main menu.',
                default: true
            }
        ]);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('An error occurred during the LetsEncrypt setup process:'), errorMessage);

        // Retry option in case of failure
        const retryAnswers: RetryConfirmation = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'retry',
                message: 'DNS verification failed. Do you want to retry the verification process?',
                default: true
            }
        ]);

        if (retryAnswers.retry && xConfiguration?.domain) {
            try {
                console.log(chalk.green('Retrying DNS verification...'));
                await verifyDNSRecord(xConfiguration.domain);
                console.log(chalk.green('DNS record verified successfully.'));
            } catch (retryError) {
                const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                console.error(chalk.red('Retry failed:'), retryErrorMsg);
            }
        }
    }
};

export default letsEncryptMethod;