import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const CONFIG_DIR = path.join('/opt/', '.get');
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'domains.db');

/**
 * Function to create the table in the database
 * @returns {Promise<void>}
 */
async function createTable() {
    const db = await open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS domains (
            domain TEXT PRIMARY KEY,
            subdomain TEXT,
            email TEXT,
            sslMode TEXT,
            sslCertificate TEXT,
            sslCertificateKey TEXT,
            target TEXT,
            type TEXT,
            projectPath TEXT,
            rootDomain TEXT,
            owner TEXT
        )
    `);

    await db.close();
}

/**
 * Function to initialize the database
 * @returns {Promise<sqlite3.Database>}
 */
export async function initializeDatabase() {
    await createTable();
    return open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });
}

const dbPromise = initializeDatabase();

/**
 * Function to add a domain
 * @param {string} domain - The domain name
 * @param {string} email - The email associated with the domain
 * @param {string} sslMode - The SSL mode
 * @param {string} sslCertificate - The SSL certificate
 * @param {string} sslCertificateKey - The SSL certificate key
 * @param {string} target - The target
 * @param {string} type - The type
 * @param {string} projectPath - The project path
 * @returns {Promise<void>}
 */
export async function registerDomain(domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner) {
    const db = await dbPromise;
    try {
        const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
        if (existingDomain) {
            throw new Error(`The domain ${domain} already exists.`);
        }
        
        await db.run(
            'INSERT INTO domains (domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner]);
    } catch (error) {
        console.error(`Error adding domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to get all domains
 * @returns {Promise<Array>}
 */
export async function getDomains() {
    try {
        const db = await dbPromise;
        return await db.all('SELECT * FROM domains');
    } catch (error) {
        console.error('Error getting domains:', error);
        throw error;
    }
}

/**
 * Function to get a domain by its name
 * @param {string} domain - The domain name
 * @returns {Promise<Object>}
 */
export async function getDomainByName(domain) {
    try {
        const db = await dbPromise;
        return await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
    } catch (error) {
        console.error(`Error getting the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to update a domain
 * @param {string} domain - The domain name
 * @param {string} email - The email associated with the domain
 * @param {string} sslMode - The SSL mode
 * @param {string} sslCertificate - The SSL certificate
 * @param {string} sslCertificateKey - The SSL certificate key
 * @param {string} target - The target
 * @param {string} type - The type
 * @param {string} projectPath - The project path
 * @returns {Promise<void>}
 */
export async function updateDomain(domain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath) {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET email = ?, sslMode = ?, sslCertificate = ?, sslCertificateKey = ?, target = ?, type = ?, projectPath = ? WHERE domain = ?', [email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, domain]);
    }
    catch (error) {
        console.error(`Error updating the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to update the target of a domain
 * @param {string} domain - The domain name
 * @param {string} target - The new target
 * @returns {Promise<void>}
 */
export async function updateDomainTarget(domain, target) {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET target = ? WHERE domain = ?', [target, domain]);
    } catch (error) {
        console.error(`Error updating the target of the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to update the type of a domain
 * @param {string} domain - The domain name
 * @param {string} type - The new type
 * @returns {Promise<void>}
 */
export async function updateDomainType(domain, type) {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET type = ? WHERE domain = ?', [type, domain]);
    } catch (error) {
        console.error(`Error updating the type of the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to delete a domain
 * @param {string} domain - The domain name
 * @returns {Promise<void>}
 */
export async function deleteDomain(domain) {
    try {
        const db = await dbPromise;
        await db.run('DELETE FROM domains WHERE domain = ?', [domain]);
    } catch (error) {
        console.error(`Error deleting the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to store configuration in the database
 * @param {string} domain - The domain name
 * @param {string} sslMode - The SSL mode
 * @param {string} sslCertificate - The SSL certificate
 * @param {string} sslCertificateKey - The SSL certificate key
 * @param {string} target - The target
 * @param {string} type - The type
 * @param {string} projectPath - The project path
 * @returns {Promise<void>}
 */
export async function storeConfigInDB(domain, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath) {
    const db = await dbPromise;
    try {
        const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
        const owner = domain.split('.').slice(-2).join('.');
        if (existingDomain) {
            await db.run('UPDATE domains SET sslMode = ?, sslCertificate = ?, sslCertificateKey = ?, target = ?, type = ?, projectPath = ?, owner = ? WHERE domain = ?', [sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner, domain]);
        } else {
            await db.run('INSERT INTO domains (domain, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [domain, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner]);
        }
    } catch (error) {
        console.error(`Error storing config for domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to write existing Nginx configurations to the database
 * @returns {Promise<void>}
 */
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
    }
}

/**
 * Function to get the configuration of a domain
 * @param {string} domain - The domain name
 * @returns {Promise<Object>}
 */
function getConfig(domain) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(USER_CONFIG_FILE);
        db.get('SELECT domain, type, port, sslCertificate, sslCertificateKey AS target FROM domains WHERE domain = ? OR domain = ?', [domain, '*.' + domain.split('.').slice(1).join('.')], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

export default { getConfig };