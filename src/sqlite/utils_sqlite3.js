import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.get');
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
            proxyRedirect TEXT
        )
    `);

    await db.close();
}

async function initializeDatabase() {
    await createTable();
    return open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });
}

const dbPromise = initializeDatabase();

// Function to add a domain
export async function addDomain(domain, email, sslMode, sslCertificate, sslCertificateKey, proxyRedirect) {
    const db = await dbPromise;
    const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
    if (existingDomain) {
        throw new Error(`The domain ${domain} already exists.`);
    }
    await db.run(
        'INSERT INTO domains (domain, email, sslMode, sslCertificate, sslCertificateKey, proxyRedirect) VALUES (?, ?, ?, ?, ?, ?)',
        [domain, email, sslMode, sslCertificate, sslCertificateKey, proxyRedirect]);
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
export async function updateDomain(domain, proxyRedirect) {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET proxy_redirect = ? WHERE domain = ?', [proxyRedirect, domain]);
    } catch (error) {
        console.error(`Error updating the domain ${domain}:`, error);
        throw error;
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
