import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { handlePermission } from '../../../utils/handlePermissions.js'; 

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
 * @returns {Promise<boolean>} - Resolves to true if both key and certificate exist, false otherwise.
 */
const checkSelfSignedCertificates = () => {
  const certDir = '/etc/ssl';
  const privateKeyPath = path.join(certDir, 'private', 'nginx-selfsigned.key');
  const certPath = path.join(certDir, 'certs', 'nginx-selfsigned.crt');

  return new Promise((resolve, reject) => {
    exec(`sudo test -f ${privateKeyPath} && sudo test -f ${certPath}`, (error) => {
      if (error) {
        console.log(chalk.red(`Error checking self-signed certificates: ${error.message}`));
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

/**
 * Generates a self-signed certificate if it doesn't already exist.
 */
const generateSelfSignedCert = async () => {
  if (checkSelfSignedCertificates()) {
    console.log(chalk.blue('Self-signed certificates already exist.'));
    return;
  }

  if (!(await isOpenSSLInstalled())) {
    console.error(chalk.red('OpenSSL is not installed. Please install OpenSSL and try again.'));
    return;
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
