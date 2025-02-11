//netget/src/modules/NetGetX/Domains/SSL/SSLCertificates.js
import fs from 'fs';
import { exec } from 'child_process';
import { spawn } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * Verifies the DNS record for the domain.
  * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain to verify.
 * @param {string} value - The value of the DNS record.
 * @returns {Promise<boolean>} Promise resolving to true if DNS record is verified, false otherwise.
 */
const verifyDNSRecord = async (domain, value) => {
    return new Promise((resolve, reject) => {
        const command = `nslookup -q=txt _acme-challenge.${domain}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to verify DNS record for ${domain}: ${error.message}`));
                reject(error);
                return;
            }
            if (stdout.includes(value)) {
                console.log(chalk.green(`DNS record verified for _acme-challenge.${domain}.`));
                resolve(true);
            } else {
                console.log(chalk.yellow(`DNS record not found yet for _acme-challenge.${domain}.`));
                resolve(false);
            }
        });
    });
};

/**
 * Obtains SSL certificates for the domain.
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain to obtain SSL certificates for.
 * @param {string} email - The email address to use for obtaining SSL certificates.
 * @returns {Promise<boolean>} Promise resolving to true if SSL certificates are obtained successfully, false otherwise.
 */ 
const obtainSSLCertificates = async (domain, email) => {
    return new Promise((resolve, reject) => {
        const command = `sudo certbot certonly --manual --preferred-challenges=dns --email ${email} --agree-tos --manual-public-ip-logging-ok --expand -d ${domain} -d *.${domain}`;
        const certbotProcess = spawn(command, { shell: true });

        let dnsChallenges = [];

        certbotProcess.stdout.on('data', async (data) => {
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
                certbotProcess.stdin.pause();
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

                certbotProcess.stdin.resume();
                certbotProcess.stdin.write('\n');
            }
        });

        certbotProcess.stderr.on('data', (data) => {
            console.error(chalk.red(data.toString()));
        });

        certbotProcess.on('close', (code) => {
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
 * @param {string} domain - The domain to wait for DNS propagation.
 * @param {string} value - The value of the DNS record.
 * @returns {Promise<boolean>} Promise resolving to true if DNS record is propagated, false otherwise.
 */ 
const waitForDNSPropagation = async (domain, value) => {
    let verified = false;
    let attempt = 0;
    while (!verified && attempt < 10) { // Maximum of 10 attempts
        attempt++;
        verified = await verifyDNSRecord(domain, value);
        if (!verified) {
            console.log(chalk.yellow(`Attempt ${attempt}: Waiting for DNS propagation...`));
            await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute before checking again
        }
    }
    return verified;
};

/**
 * Verifies the SSL certificate for the domain.
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain to verify.
 * @returns {Promise<boolean>} Promise resolving to true if SSL certificate is verified, false otherwise.
 */ 
const verifySSLCertificate = async (domain) => {
    return new Promise((resolve, reject) => {
        const command = `openssl s_client -connect ${domain}:443 -servername ${domain}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to verify SSL certificate for ${domain}: ${error.message}`));
                reject(error);
                return;
            }
            console.log(chalk.green(`SSL certificate verification result for ${domain}:`));
            console.log(stdout);
            resolve(true);
        });
    });
};

/**
 * Renews the SSL certificate for the domain.
 * @memberof module:NetGetX.SSL 
 * @param {string} domain - The domain to renew SSL certificate for.
 * @returns {Promise<boolean>} Promise resolving to true if SSL certificate is renewed successfully, false otherwise.
 */
const renewSSLCertificate = async (domain) => {
    return new Promise((resolve, reject) => {
        const command = `sudo certbot renew --nginx -d ${domain} --non-interactive --agree-tos`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to renew SSL certificate for ${domain}: ${error.message}`));
                reject(error);
                return;
            }
            console.log(chalk.green(`SSL certificate renewed successfully for ${domain}.`));
            console.log(stdout);
            resolve(true);
        });
    });
};

/**
 * Check if certificates are issued for the domain.
 * @memberof module:NetGetX.SSL
 * @param {string} domain - The domain to check.
 * @returns {Promise<boolean>} Promise resolving to true if certificates are issued, false otherwise.
 */
const checkCertificates = (domain) => {
    return new Promise((resolve, reject) => {
        const command = `sudo certbot certificates --domain ${domain}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to check certificates for ${domain}: ${error.message}`));
                reject(error);
                return;
            }
            if (stdout.includes(`Certificate Name: ${domain}`)) {
                console.log(chalk.green(`Certificates are issued for ${domain}.`));
                resolve(true);
            } else {
                console.log(chalk.yellow(`No certificates found for ${domain}.`));
                resolve(false);
            }
        });
    });
};

/**
 * Scans and logs information about all issued certificates.
 * @memberof module:NetGetX.SSL
 * @returns {Promise<void>}
 */
const scanAndLogCertificates = async () => {
    return new Promise((resolve, reject) => {
        const command = `sudo certbot certificates`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(chalk.red(`Failed to scan certificates: ${error.message}`));
                reject(error);
                return;
            }
            console.log(chalk.green('Issued Certificates:'));
            console.log(stdout);
            resolve();
        });
    });
};

export {
     obtainSSLCertificates,
     verifySSLCertificate, 
     renewSSLCertificate, 
     verifyDNSRecord, 
     checkCertificates, 
     scanAndLogCertificates };
