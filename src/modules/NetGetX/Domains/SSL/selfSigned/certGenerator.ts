import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Interface for certificate generation result
interface CertificateResult {
    success: boolean;
    certPath?: string;
    keyPath?: string;
    error?: string;
}

/**
 * Generates a self-signed certificate for a domain
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to generate certificate for
 * @param certDir - Directory to save certificates (optional)
 * @returns Promise resolving to certificate generation result
 */
const generateSelfSignedCertificate = async (domain: string, certDir?: string): Promise<CertificateResult> => {
    try {
        const certificateDir = certDir || `/etc/ssl/private/${domain}`;
        const certPath = path.join(certificateDir, 'fullchain.pem');
        const keyPath = path.join(certificateDir, 'privkey.pem');

        // Ensure directory exists
        if (!fs.existsSync(certificateDir)) {
            fs.mkdirSync(certificateDir, { recursive: true });
        }

        // Generate self-signed certificate using OpenSSL
        const opensslCommand = [
            'openssl req -x509 -newkey rsa:4096',
            `-keyout "${keyPath}"`,
            `-out "${certPath}"`,
            '-sha256 -days 365 -nodes',
            `-subj "/C=US/ST=State/L=City/O=Organization/OU=OrgUnit/CN=${domain}"`
        ].join(' ');

        console.log(chalk.blue(`Generating self-signed certificate for ${domain}...`));
        await execAsync(opensslCommand);

        // Verify files were created
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            console.log(chalk.green(`Self-signed certificate generated successfully for ${domain}`));
            console.log(chalk.blue(`Certificate: ${certPath}`));
            console.log(chalk.blue(`Private Key: ${keyPath}`));
            
            return {
                success: true,
                certPath,
                keyPath
            };
        } else {
            throw new Error('Certificate files were not created');
        }
    } catch (error: any) {
        console.error(chalk.red(`Error generating self-signed certificate for ${domain}:`, error.message));
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Checks if self-signed certificate exists for a domain
 * @memberof module:NetGetX.SSL
 * @param domain - The domain to check
 * @param certDir - Directory to check for certificates (optional)
 * @returns True if certificate exists, false otherwise
 */
const checkSelfSignedCertificate = (domain: string, certDir?: string): boolean => {
    try {
        const certificateDir = certDir || `/etc/ssl/private/${domain}`;
        const certPath = path.join(certificateDir, 'fullchain.pem');
        const keyPath = path.join(certificateDir, 'privkey.pem');

        return fs.existsSync(certPath) && fs.existsSync(keyPath);
    } catch (error: any) {
        console.error(chalk.red(`Error checking self-signed certificate for ${domain}:`, error.message));
        return false;
    }
};

export { 
    generateSelfSignedCertificate, 
    checkSelfSignedCertificate,
    type CertificateResult 
};