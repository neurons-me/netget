import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const CONFIG_DIR = path.join('/opt/','.get');
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'domains.db');

async function generateID(domain) {
    return uuidv4(domain);
}

async function createTable() {
    const db = await open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS domains (
            domain TEXT PRIMARY KEY,
            email TEXT,
            sslMode TEXT,
            sslCertificate TEXT,
            sslCertificateKey TEXT,
            nginxConfig TEXT,
            port TEXT,
            type TEXT
        )
    `);

    await db.close();
}

export async function initializeDatabase() {
    await createTable();
    return open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });
}

const dbPromise = initializeDatabase();

// Function to add a domain
export async function addDomain(domain, email, sslMode, sslCertificate, sslCertificateKey, nginxConfig, port, type) {
    const db = await dbPromise;
    try {
        const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
        if (existingDomain) {
            throw new Error(`The domain ${domain} already exists.`);
        }
        await db.run(
            'INSERT INTO domains (domain, email, sslMode, sslCertificate, sslCertificateKey, nginxConfig, port, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [domain, email, sslMode, sslCertificate, sslCertificateKey, nginxConfig, port, type]);
    } finally {
        await db.close();
    }
}

// Function to get all domains
export async function getDomains() {
    try {
        const db = await dbPromise;
        return await db.all('SELECT * FROM domains');
    } catch (error) {
        console.error('Error getting domains:', error);
        throw error;
    }
}

// Function to get a domain by its name
export async function getDomainByName(domain) {
    try {
        const db = await dbPromise;
        return await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
    } catch (error) {
        console.error(`Error getting the domain ${domain}:`, error);
        throw error;
    } 
}

// Function to update the redirection of a domain
export async function updateDomain(domain, port) {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET proxy_redirect = ? WHERE domain = ?', [port, domain]);
    } catch (error) {
        console.error(`Error updating the domain ${domain}:`, error);
        throw error;
    } finally {
        await db.close();
    }
}

// Function to delete a domain
export async function deleteDomain(domain) {
    try {
        const db = await dbPromise;
        await db.run('DELETE FROM domains WHERE domain = ?', [domain]);
    } catch (error) {
        console.error(`Error deleting the domain ${domain}:`, error);
        throw error;
    }
}

export async function storeConfig(domain, nginxConfig) {
    const db = await dbPromise;
    try {
        const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
        if (existingDomain) {
            await db.run('UPDATE domains SET nginxConfig = ? WHERE domain = ?', [nginxConfig, domain]);
        } else {
            await db.run('INSERT INTO domains (domain, nginxConfig) VALUES (?, ?)', [domain, nginxConfig]);
        }
    } catch (error) {
        console.error(`Error storing config for domain ${domain}:`, error);
        throw error;
    }
}

export async function writeExistingNginxConfigs() {
    const db = await dbPromise;
    try {
        const configDir = '/etc/nginx/XBlocks-available/';
        const files = fs.readdirSync(configDir);

        for (const file of files) {
            const domain = path.basename(file, '.conf');
            const nginxConfig = fs.readFileSync(path.join(configDir, file), 'utf-8');
            const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);

            if (existingDomain) {
                await db.run('UPDATE domains SET nginxConfig = ? WHERE domain = ?', [nginxConfig, domain]);
            } else {
                await db.run('INSERT INTO domains (domain, nginxConfig) VALUES (?, ?)', [domain, nginxConfig]);
            }
        }
    } catch (error) {
        console.error('Error writing existing nginx configs:', error);
        throw error;
    } finally {
        await db.close();
    }
}

async function generateNginxConfig() {
    const db = await dbPromise;
    try {
        const configs = await db.all('SELECT * FROM nginx_config');

        let nginxConfig = '';
        configs.forEach(config => {
            nginxConfig += config.config + '\n';
        });

        fs.writeFileSync('/etc/nginx/conf.d/custom.conf', nginxConfig);
    } finally {
        await db.close();
    }
}


function getConfig(domain) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(USER_CONFIG_FILE);
        db.get('SELECT domain, type, port, sslCertificate, sslCertificateKey AS target FROM domains WHERE domain = ? OR domain = ?', [domain, '*.' + domain.split('.').slice(1).join('.')], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
            db.close();
        });
    });
}

// Function to migrate the table into a new schema
async function migrateTable() {
    const db = await open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });

    // Start a transaction
    await db.exec('BEGIN TRANSACTION');

    // Create a new table without the column to be removed
    await db.exec(`
        CREATE TABLE domains_new (
            domain TEXT PRIMARY KEY,
            email TEXT,
            sslMode TEXT,
            sslCertificate TEXT,
            sslCertificateKey TEXT,
            nginxConfig TEXT,
            port TEXT,
            type TEXT
        )
    `);

    // Copy data from the old table to the new table
    await db.exec(`
        INSERT INTO domains_new (domain, email, sslMode, sslCertificate, nginxConfig, port, type)
        SELECT domain, email, sslMode, sslCertificate, nginxConfig, port, type
        FROM domains
    `);

    // Drop the old table
    await db.exec('DROP TABLE domains');

    // Rename the new table to the original table name
    await db.exec('ALTER TABLE domains_new RENAME TO domains');

    // Commit the transaction
    await db.exec('COMMIT');

    await db.close();
}

// migrateTable().catch(err => {
//     console.error(err);
// });

export default { getConfig };