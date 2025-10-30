import * as sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as fs from 'fs';
import { loadXConfig } from '../modules/NetGetX/config/xConfig.ts';

const xConfig = await loadXConfig();

const sqliteDatabasePath: string = xConfig.sqliteDatabasePath;

/**
 * Store the SSL certificate and key for a domain in the database.
 * @param domain - The domain to store the certificate information for.
 * @param certPath - The path to the SSL certificate file.
 * @param keyPath - The path to the SSL certificate key file.
 */
async function storeCertificateInfo(domain: string, certPath: string, keyPath: string): Promise<void> {
    const db = await open({
        filename: sqliteDatabasePath,
        driver: sqlite3.Database
    });

    try {
        const cert: string = fs.readFileSync(certPath, 'utf8');
        const key: string = fs.readFileSync(keyPath, 'utf8');

        await db.run(
            `INSERT INTO domains (domain, sslCertificate, sslCertificateKey) VALUES (?, ?, ?) 
             ON CONFLICT(domain) DO UPDATE SET sslCertificate = excluded.sslCertificate, sslCertificateKey = excluded.sslCertificateKey`,
            [domain, cert, key]
        );

        console.log(`Certificate information for ${domain} stored successfully.`);
    } catch (error: any) {
        console.error(`Error storing certificate information for ${domain}:`, error);
    } finally {
        await db.close();
    }
}

export { storeCertificateInfo };

// Example usage
// const domain = 'cafedelpais.com.mx';
// const certPath = '/etc/letsencrypt/archive/cafedelpais.com.mx/fullchain1.pem';
// const keyPath = '/etc/letsencrypt/archive/cafedelpais.com.mx/privkey1.pem';

// storeCertificateInfo(domain, certPath, keyPath).catch(err => {
//     console.error(err);
// });