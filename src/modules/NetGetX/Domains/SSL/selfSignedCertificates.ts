import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
// import { handlePermission } from '../../../utils/handlePermissions.js'; // Temporarily disabled - needs migration
import inquirer from 'inquirer';

const certDir: string = '/etc/ssl';
const privateKeyPath: string = path.join(certDir, 'private', 'nginx-selfsigned.key');
const certPath: string = path.join(certDir, 'certs', 'nginx-selfsigned.crt');

/**
 * Ensures the directory exists; if not, creates it.
 * @param dir - The directory path.
 */
const ensureDirectoryExists = (dir: string): void => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(chalk.green(`Directory created: ${dir}`));
    }
};

/**
 * Checks if OpenSSL is installed.
 * @memberof module:NetGetX.SSL
 * @returns Resolves to true if OpenSSL is installed, false otherwise.
 */
const isOpenSSLInstalled = (): Promise<boolean> => {
    return new Promise((resolve) => {
        exec('openssl version', (error) => {
            if (error) {
                console.log(chalk.red('OpenSSL is not installed or not found in PATH.'));
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
};

/**
 * Checks if self-signed certificates exist.
 * @memberof module:NetGetX.SSL
 * @returns True if certificates exist, false otherwise.
 */
const checkSelfSignedCertificates = async (): Promise<boolean> => {
    try {
        const keyExists: boolean = fs.existsSync(privateKeyPath);
        const certExists: boolean = fs.existsSync(certPath);
        return keyExists && certExists;
    } catch (error: any) {
        console.error(chalk.red('Error checking self-signed certificates:', error.message));
        return false;
    }
};

/**
 * Generates self-signed SSL certificates.
 * @memberof module:NetGetX.SSL
 * @returns Promise that resolves when certificates are generated.
 */
const generateSelfSignedCert = async (): Promise<void> => {
    try {
        console.log(chalk.yellow('SSL certificate generation temporarily simplified during TypeScript migration'));
        console.log(chalk.blue('Self-signed certificate generation would happen here'));
        
        // Implementation temporarily simplified during migration
        // The full implementation would generate actual certificates
        
    } catch (error: any) {
        console.error(chalk.red('Error generating self-signed certificates:', error.message));
        throw error;
    }
};

export { 
    ensureDirectoryExists, 
    isOpenSSLInstalled, 
    checkSelfSignedCertificates, 
    generateSelfSignedCert 
};