import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { handlePermission } from '../../../utils/handlePermissions.js'; 
import inquirer from 'inquirer';

const certDir = '/etc/ssl';
const privateKeyPath = path.join(certDir, 'private', 'nginx-selfsigned.key');
const certPath = path.join(certDir, 'certs', 'nginx-selfsigned.crt');

/**
 * Ensures the directory exists; if not, creates it.
 * @param {string} dir - The directory path.
 */
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(chalk.green(`Directory created: ${dir}`));
  }
};

/**
 * Checks if OpenSSL is installed.
 * @memberof module:NetGetX.SSL
 * @returns {Promise<boolean>} - Resolves to true if OpenSSL is installed, false otherwise.
 */
const isOpenSSLInstalled = () => {
  return new Promise((resolve) => {
    exec('openssl version', (error) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

/**
 * Checks if self-signed certificates already exist.
 * @memberof module:NetGetX.SSL
 * @returns {Promise<boolean>} - Resolves to true if both key and certificate exist, false otherwise.
 */
async function checkSelfSignedCertificates() {
  try {
    const keyExists = fs.existsSync(privateKeyPath);
    const certExists = fs.existsSync(certPath);

    return keyExists && certExists;
  } catch (error) {
    console.log(chalk.red(`Error checking self-signed certificates: ${error.message}`));
    return false;
  }
}

/**
 * Generates a self-signed certificate if it doesn't already exist.
 * @memberof module:NetGetX.SSL
 */
const generateSelfSignedCert = async () => {
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
    await execShellCommand(cmd);
    console.log(chalk.green(`Self-signed certificates generated successfully.\nKey: ${privateKeyPath}\nCert: ${certPath}`));
  } catch (error) {
    if (error.message.includes('Permission denied')) {
      console.error(chalk.red(`Permission error: ${error.message}`));
      await handlePermission(
        'generating self-signed certificates',
        cmd,
        `Please run the following command manually to generate the certificates:\n${cmd}`
      );
    } else {
      console.error(chalk.red(`Error generating self-signed certificates: ${error.message}`));
    }
  }
};

/**
 * Executes a shell command and returns a promise.
 * @memberof module:NetGetX.SSL
 * @param {string} cmd - The command to execute.
 * @returns {Promise<void>}
 */
const execShellCommand = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
};

export { generateSelfSignedCert, checkSelfSignedCertificates, isOpenSSLInstalled };
