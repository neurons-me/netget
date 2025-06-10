import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DATABASE_PATH = '/opt/.get/domains.db';

async function updateSSLCertificatePaths() {
    const db = await open({
        filename: DATABASE_PATH,
        driver: sqlite3.Database
    });

    try {
        const domains = await db.all('SELECT domain, subdomain FROM domains');
        
        for (const { domain, subdomain } of domains) {
            const sslCertificatePath = `/etc/letsencrypt/live/${subdomain}/fullchain.pem`;
            const sslCertificateKeyPath = `/etc/letsencrypt/live/${subdomain}/privkey.pem`;

            await db.run(
                `UPDATE domains SET sslCertificate = ?, sslCertificateKey = ? WHERE domain = ?`,
                [sslCertificatePath, sslCertificateKeyPath, domain]
            );

            console.log(`Updated SSL paths for domain: ${subdomain}`);
        }
    } catch (error) {
        console.error('Error updating SSL certificate paths:', error);
    } finally {
        await db.close();
    }
}

updateSSLCertificatePaths().catch(err => {
    console.error(err);
});