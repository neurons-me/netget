import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import { getDomainsDbPath } from '../utils/netgetPaths.js';


const USER_CONFIG_FILE = getDomainsDbPath();


/**
 * Store the SSL certificate and key for a domain in the database.
 * @param {string} domain - The domain to store the certificate information for.
 * @param {string} certPath - The path to the SSL certificate file.
 * @param {string} keyPath - The path to the SSL certificate key file.
 */
async function storeCertificateInfo(domain, certPath, keyPath) {
    const db = await open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });

    try {
        const cert = fs.readFileSync(certPath, 'utf8');
        const key = fs.readFileSync(keyPath, 'utf8');

        await db.run(
            `INSERT INTO domains (domain, sslCertificate, sslCertificateKey) VALUES (?, ?, ?) 
             ON CONFLICT(domain) DO UPDATE SET sslCertificate = excluded.sslCertificate, sslCertificateKey = excluded.sslCertificateKey`,
            [domain, cert, key]
        );

        console.log(`Certificate information for ${domain} stored successfully.`);
    } catch (error) {
        console.error(`Error storing certificate information for ${domain}:`, error);
    } finally {
        await db.close();
    }
}

// Example usage
// const domain = 'cafedelpais.com.mx';
// const certPath = '/etc/letsencrypt/archive/cafedelpais.com.mx/fullchain1.pem';
// const keyPath = '/etc/letsencrypt/archive/cafedelpais.com.mx/privkey1.pem';

// storeCertificateInfo(domain, certPath, keyPath).catch(err => {
//     console.error(err);
// });
