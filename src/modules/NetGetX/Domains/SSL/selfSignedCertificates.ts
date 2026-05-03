import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { handlePermission } from '../../../utils/handlePermissions.ts';
import inquirer from 'inquirer';

const execAsync = promisify(exec);

const certDir: string = '/etc/ssl';
const certPath: string = path.join(certDir, 'certs', 'nginx-selfsigned.crt');
const privateKeyPath: string = path.join(certDir, 'private', 'nginx-selfsigned.key');

interface SelfSignedCertificateStatus {
    certPath: string;
    keyPath: string;
    certExists: boolean;
    keyExists: boolean;
    valid: boolean;
    subject?: string;
    issuer?: string;
    notBefore?: string;
    notAfter?: string;
    san?: string;
    error?: string;
}

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

const getSelfSignedCertificateStatus = async (): Promise<SelfSignedCertificateStatus> => {
    const certExists = fs.existsSync(certPath);
    const keyExists = fs.existsSync(privateKeyPath);
    const status: SelfSignedCertificateStatus = {
        certPath,
        keyPath: privateKeyPath,
        certExists,
        keyExists,
        valid: certExists && keyExists,
    };

    if (!certExists) return status;

    try {
        const { stdout } = await execAsync(`openssl x509 -in "${certPath}" -noout -subject -issuer -dates -ext subjectAltName`);
        const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        status.subject = lines.find((line) => line.startsWith('subject='))?.replace(/^subject=\s*/, '');
        status.issuer = lines.find((line) => line.startsWith('issuer='))?.replace(/^issuer=\s*/, '');
        status.notBefore = lines.find((line) => line.startsWith('notBefore='))?.replace(/^notBefore=/, '');
        status.notAfter = lines.find((line) => line.startsWith('notAfter='))?.replace(/^notAfter=/, '');
        const sanIndex = lines.findIndex((line) => /Subject Alternative Name/i.test(line));
        if (sanIndex >= 0 && lines[sanIndex + 1]) status.san = lines[sanIndex + 1];
    } catch (error: any) {
        status.valid = false;
        status.error = error.message;
    }

    return status;
};

function writeOpenSSLConfig(): string {
    const configPath = path.join(osTmpDir(), 'netget-localnetget-openssl.cnf');
    fs.writeFileSync(configPath, [
        '[req]',
        'distinguished_name = req_distinguished_name',
        'x509_extensions = v3_req',
        'prompt = no',
        '',
        '[req_distinguished_name]',
        'CN = local.netget',
        '',
        '[v3_req]',
        'subjectAltName = @alt_names',
        'keyUsage = critical, digitalSignature, keyEncipherment',
        'extendedKeyUsage = serverAuth',
        '',
        '[alt_names]',
        'DNS.1 = local.netget',
        'DNS.2 = localhost',
        'IP.1 = 127.0.0.1',
        '',
    ].join('\n'), 'utf8');
    return configPath;
}

function osTmpDir(): string {
    return process.env.TMPDIR || '/tmp';
}

async function createSelfSignedCert({ force = false, prompt = true }: { force?: boolean; prompt?: boolean } = {}): Promise<void> {
  if (prompt) {
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
    return;
  }

  const opensslConfigPath = writeOpenSSLConfig();
  const mkdirCmd = `mkdir -p "${path.join(certDir, 'private')}" "${path.join(certDir, 'certs')}"`;
  const cleanupCmd = force ? `rm -f "${privateKeyPath}" "${certPath}" && ` : '';
  const certCmd = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout "${privateKeyPath}" -out "${certPath}" -config "${opensslConfigPath}" -extensions v3_req`;
  const fullCmd = `${mkdirCmd} && ${cleanupCmd}${certCmd}`;
  const shWrapped = `sh -c '${fullCmd}'`;

  try {
    await execAsync(fullCmd);
    console.log(chalk.green(`Self-signed certificates generated successfully.\nKey: ${privateKeyPath}\nCert: ${certPath}`));
  } catch (error: any) {
    if (error.code === 'EACCES' || error.message?.includes('ermission')) {
      console.log(chalk.yellow('Write access to /etc/ssl requires elevated privileges.'));
      await handlePermission(
        `${force ? 'renewing' : 'generating'} self-signed certificates (write access to /etc/ssl)`,
        shWrapped,
        `Please run manually:\nsudo ${mkdirCmd}\nsudo ${certCmd}`
      );
    } else {
      console.error(chalk.red(`Error generating self-signed certificates: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

/**
 * Generates a self-signed certificate if it doesn't already exist.
 * @memberof module:NetGetX.SSL
 */
const generateSelfSignedCert = async (): Promise<void> => {
  await createSelfSignedCert({ force: false, prompt: true });
};

const renewSelfSignedCert = async (): Promise<void> => {
  await createSelfSignedCert({ force: true, prompt: false });
};

export {
    isOpenSSLInstalled,
    checkSelfSignedCertificates,
    generateSelfSignedCert,
    renewSelfSignedCert,
    getSelfSignedCertificateStatus,
    certPath,
    privateKeyPath
};
export type { SelfSignedCertificateStatus };
