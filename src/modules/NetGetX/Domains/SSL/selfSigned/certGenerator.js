import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

/**
 * Generate a self-signed certificate for localhost
 * @param {string} certPath - Path to save the certificate
 * @returns {Promise<{certPath: string, keyPath: string}>}
 */
const generateSelfSignedCert = async (certPath) => {
    const certDir = path.dirname(certPath);
    const keyPath = path.join(certDir, 'key.pem');
    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
    }

    const command = `
        openssl req -x509 -newkey rsa:4096 -keyout ${keyPath} -out ${certPath} -days 365 -nodes -subj "/CN=localhost"
    `;

    try {
        await execPromise(command);
        console.log('Self-Signed Certificate generated successfully.');
        return { certPath, keyPath };
    } catch (error) {
        console.error('Error generating self-signed certificate:', error);
        throw error;
    }
};

export { generateSelfSignedCert };
