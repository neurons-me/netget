import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DATABASE_PATH = '/opt/.get/domains.db';

async function updateSSLCertificatePaths() {
    const db = await open({
        filename: DATABASE_PATH,
        driver: sqlite3.Database
    });

    try {
        const domains = await db.all('SELECT domain FROM domains');

        for (const { domain } of domains) {
            const sslCertificatePath = `/etc/letsencrypt/archive/${domain}/fullchain1.pem`;
            const sslCertificateKeyPath = `/etc/letsencrypt/archive/${domain}/privkey1.pem`;

            await db.run(
                `UPDATE domains SET sslCertificate = ?, sslCertificateKey = ? WHERE domain = ?`,
                [sslCertificatePath, sslCertificateKeyPath, domain]
            );

            console.log(`Updated SSL paths for domain: ${domain}`);
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