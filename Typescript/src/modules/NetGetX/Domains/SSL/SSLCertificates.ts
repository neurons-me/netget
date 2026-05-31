//netget/src/modules/NetGetX/Domains/SSL/SSLCertificates.ts
import fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer';
import chalk from 'chalk';

const execAsync = promisify(exec);

interface DNSChallenge {
    domain: string;
    value: string;
}

/**
 * Verifies the DNS record for the domain.
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to verify.
 * @param value - The value of the DNS record.
 * @returns Promise resolving to true if DNS record is verified, false otherwise.
 */
const verifyDNSRecord = async (domain: string, value: string): Promise<boolean> => {
    try {
        const command = `nslookup -q=txt _acme-challenge.${domain}`;
        const { stdout } = await execAsync(command);
        
        if (stdout.includes(value)) {
            console.log(chalk.green(`DNS record verified for _acme-challenge.${domain}.`));
            return true;
        } else {
            console.log(chalk.yellow(`DNS record not found yet for _acme-challenge.${domain}.`));
            return false;
        }
    } catch (error: any) {
        console.error(chalk.red(`Failed to verify DNS record for ${domain}: ${error.message}`));
        throw error;
    }
};

/**
 * Scans and logs SSL certificates information.
 * @memberof module:NetGetX.SSL
 */
const scanAndLogCertificates = async (): Promise<void> => {
    try {
        const letsEncryptPath = '/etc/letsencrypt/live';
        
        if (!fs.existsSync(letsEncryptPath)) {
            console.log(chalk.yellow('No Let\'s Encrypt certificates found.'));
            return;
        }
        
        const domains = fs.readdirSync(letsEncryptPath);
        
        if (domains.length === 0) {
            console.log(chalk.yellow('No SSL certificates found.'));
            return;
        }
        
        console.log(chalk.green('\n=== SSL Certificates ==='));
        for (const domain of domains) {
            const certPath = `${letsEncryptPath}/${domain}/cert.pem`;
            if (fs.existsSync(certPath)) {
                try {
                    const { stdout } = await execAsync(`openssl x509 -in ${certPath} -noout -dates`);
                    console.log(chalk.blue(`\nDomain: ${domain}`));
                    console.log(stdout.trim());
                } catch (error: any) {
                    console.error(chalk.red(`Error reading certificate for ${domain}: ${error.message}`));
                }
            }
        }
        console.log(chalk.green('\n========================\n'));
    } catch (error: any) {
        console.error(chalk.red(`Error scanning certificates: ${error.message}`));
    }
};

/**
 * Checks if a certificate exists for a domain.
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to check certificates for.
 * @returns True if certificate exists, false otherwise.
 */
const checkCertificateExists = async (domain: string): Promise<boolean> => {
    try {
        const certPath = `/etc/letsencrypt/live/${domain}/cert.pem`;
        const keyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
        
        const certExists = fs.existsSync(certPath);
        const keyExists = fs.existsSync(keyPath);
        
        if (certExists && keyExists) {
            console.log(chalk.green(`Certificate found for domain: ${domain}`));
            return true;
        } else {
            console.log(chalk.yellow(`Certificate not found for domain: ${domain}`));
            return false;
        }
    } catch (error: any) {
        console.error(chalk.red(`Error checking certificate for ${domain}: ${error.message}`));
        return false;
    }
};

/**
 * Obtains SSL certificates for the domain.
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to obtain SSL certificates for.
 * @param email - The email address to use for obtaining SSL certificates.
 * @returns Promise resolving to true if SSL certificates are obtained successfully, false otherwise.
 */ 
const obtainSSLCertificates = async (domain: string, email: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        const command = `sudo certbot certonly --manual --preferred-challenges=dns --email ${email} --agree-tos --manual-public-ip-logging-ok --expand -d ${domain} -d *.${domain}`;
        const certbotProcess = spawn(command, { shell: true });

        const dnsChallenges: DNSChallenge[] = [];

        certbotProcess.stdout.on('data', async (data: Buffer) => {
            const message = data.toString();
            console.log(chalk.cyan(message));

            if (message.includes('Please deploy a DNS TXT record under the name')) {
                const match = message.match(/Please deploy a DNS TXT record under the name\n\n_acme-challenge\..*? with the following value:\n\n(.+?)\n/);
                if (match) {
                    const value = match[1].trim();
                    dnsChallenges.push({ domain, value });

                    console.log(chalk.green(`Please add the following DNS TXT record:`));
                    console.log(chalk.green(`Name: _acme-challenge.${domain}`));
                    console.log(chalk.green(`Value: ${value}`));
                }
            }

            if (message.includes('Press Enter to Continue')) {
                await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'continue',
                        message: 'Have you deployed the DNS TXT record(s)? Press Enter to continue.',
                        default: true
                    }
                ]);

                let verified = false;
                for (const { domain, value } of dnsChallenges) {
                    verified = await waitForDNSPropagation(domain, value);
                    if (!verified) {
                        console.error(chalk.red(`DNS propagation timed out for ${domain}. Please try again later.`));
                        certbotProcess.kill();
                        reject(new Error('DNS propagation timed out'));
                        return;
                    }
                }

                certbotProcess.stdin.write('\n');
            }
        });

        certbotProcess.stderr.on('data', (data: Buffer) => {
            console.error(chalk.red(data.toString()));
        });

        certbotProcess.on('close', (code: number | null) => {
            if (code !== 0) {
                console.error(chalk.red(`Certbot process exited with code ${code}`));
                reject(new Error(`Certbot process exited with code ${code}`));
            } else {
                console.log(chalk.green(`SSL certificates obtained successfully for ${domain} and *.${domain}.`));
                resolve(true);
            }
        });
    });
};

/**
 * Waits for DNS propagation of the DNS record.
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to wait for DNS propagation.
 * @param value - The value of the DNS record.
 * @returns Promise resolving to true if DNS record is propagated, false otherwise.
 */ 
const waitForDNSPropagation = async (domain: string, value: string): Promise<boolean> => {
    let verified = false;
    let attempt = 0;
    const maxAttempts = 10;
    const waitTime = 60000; // 1 minute in milliseconds
    
    while (!verified && attempt < maxAttempts) {
        attempt++;
        verified = await verifyDNSRecord(domain, value);
        if (!verified) {
            console.log(chalk.yellow(`Attempt ${attempt}/${maxAttempts}: Waiting for DNS propagation...`));
            await new Promise<void>(resolve => setTimeout(resolve, waitTime));
        }
    }
    return verified;
};

/**
 * Verifies the SSL certificate for the domain.
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to verify.
 * @returns Promise resolving to true if SSL certificate is verified, false otherwise.
 */ 
const verifySSLCertificate = async (domain: string): Promise<boolean> => {
    try {
        const command = `openssl s_client -connect ${domain}:443 -servername ${domain} </dev/null`;
        const { stdout } = await execAsync(command);
        
        console.log(chalk.green(`SSL certificate verification result for ${domain}:`));
        console.log(stdout);
        return true;
    } catch (error: any) {
        console.error(chalk.red(`Failed to verify SSL certificate for ${domain}: ${error.message}`));
        throw error;
    }
};

/**
 * Renews the SSL certificate for the domain.
 * @memberof module:NetGetX.SSL 
 * @param domain - The domain to renew SSL certificate for.
 * @returns Promise resolving to true if SSL certificate is renewed successfully, false otherwise.
 */
const renewSSLCertificate = async (domain: string): Promise<boolean> => {
    try {
        const command = `sudo certbot renew --nginx -d ${domain} --non-interactive --agree-tos`;
        const { stdout } = await execAsync(command);
        
        console.log(chalk.green(`SSL certificate renewed successfully for ${domain}.`));
        console.log(stdout);
        return true;
    } catch (error: any) {
        console.error(chalk.red(`Failed to renew SSL certificate for ${domain}: ${error.message}`));
        throw error;
    }
};

export { 
    verifyDNSRecord, 
    scanAndLogCertificates, 
    checkCertificateExists,
    obtainSSLCertificates,
    verifySSLCertificate,
    renewSSLCertificate
};