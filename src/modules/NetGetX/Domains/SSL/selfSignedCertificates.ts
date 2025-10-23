import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { handlePermission } from '../../../utils/handlePermissions.ts';
import inquirer from 'inquirer';

const execAsync = promisify(exec);

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
const isOpenSSLInstalled = async (): Promise<boolean> => {
    try {
        await execAsync('openssl version');
        return true;
    } catch (error) {
        console.log(chalk.red('OpenSSL is not installed or not found in PATH.'));
        return false;
    }
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
 * Generates a self-signed certificate if it doesn't already exist.
 * @memberof module:NetGetX.SSL
 */
const generateSelfSignedCert = async (): Promise<void> => {
  const { generateCerts } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'generateCerts',
      message: `Do you want to generate self-signed certificates in the following paths?\nKey: ${privateKeyPath}\nCert: ${certPath}`,
      default: false,
    },
  ]);

  if (!generateCerts) {
    console.log(chalk.yellow('Certificate generation aborted by user.'));
    return;
  }
  const opensslInstalled = await isOpenSSLInstalled();
  if (!opensslInstalled) {
    const { installOpenSSL } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'installOpenSSL',
        message: 'OpenSSL is not installed. Do you want to install it to continue?',
        default: false,
      },
    ]);
    if (installOpenSSL) {
      console.log(chalk.yellow('Please install OpenSSL by running the following command according to your operating system:'));
      console.log(chalk.cyan('\nUbuntu/Debian: sudo apt-get install openssl\nRedHat/CentOS: sudo yum install openssl\nMacOS (Homebrew): brew install openssl\n'));
      console.log(chalk.yellow('After installing OpenSSL, please rerun this process.'));
    } else {
      console.log(chalk.red('Process aborted because OpenSSL is required.'));
    }
    process.exit();
  }

  ensureDirectoryExists(path.join(certDir, 'private'));
  ensureDirectoryExists(path.join(certDir, 'certs'));

  const cmd = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ${privateKeyPath} -out ${certPath} -subj "/CN=local.netget"`;

  try {
    await execAsync(cmd);
    console.log(chalk.green(`Self-signed certificates generated successfully.\nKey: ${privateKeyPath}\nCert: ${certPath}`));
  } catch (error: any) {
    if (error.message && error.message.includes('Permission denied')) {
      console.error(chalk.red(`Permission error: ${error.message}`));
      await handlePermission(
        'generating self-signed certificates',
        cmd,
        `Please run the following command manually to generate the certificates:\n${cmd}`
      );
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error generating self-signed certificates: ${errorMessage}`));
    }
  }
};

export { 
    ensureDirectoryExists, 
    isOpenSSLInstalled, 
    checkSelfSignedCertificates, 
    generateSelfSignedCert 
};