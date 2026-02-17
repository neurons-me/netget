
import sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { handlePermission } from '../modules/utils/handlePermissions.ts';
import chalk from 'chalk';
import { initializeDirectories } from '../modules/utils/GETDirs.ts';
import { getNetgetDataDir } from '../utils/netgetPaths.js';

// Ensure necessary directories exist before database operations
await initializeDirectories();

const xConfig = getNetgetDataDir();

const sqliteDatabasePath: string = path.join(xConfig, 'domains.db');

/**
 * Promisified database wrapper for sqlite3
 */
class Database {
    private db: sqlite3.Database;

    constructor(filename: string) {
        this.db = new sqlite3.Database(filename);
    }

    exec(sql: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    run(sql: string, params: any[] = []): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    get(sql: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

interface DomainRecord {
    domain: string;
    subdomain?: string;
    email?: string;
    sslMode?: string;
    sslCertificate?: string;
    sslCertificateKey?: string;
    target?: string;
    type?: string;
    projectPath?: string;
    rootDomain?: string;
    owner?: string;
    nginxConfig?: string;
}

interface DomainConfigResult {
    domain: string;
    type: string;
    port?: number;
    sslCertificate?: string;
    target: string;
}

/**
 * Function to create the table in the database
 */
async function createTable(): Promise<void> {
    try {
        const db = new Database(sqliteDatabasePath);

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
                owner TEXT,
                nginxConfig TEXT
            )
        `);

        // Close the database to release file handles
        await db.close();
        
    } catch (error: any) {
        console.error(chalk.red(`\nFailed to create table in database: ${error.message}`));
    }
}

/**
 * Function to initialize the database
 */
export async function initializeDatabase(): Promise<Database> {
    await createTable();
    return new Database(sqliteDatabasePath);
}

const dbPromise = initializeDatabase();

/**
 * Function to add a domain
 */
export async function registerDomain(
    domain: string, 
    subdomain?: string, 
    email?: string, 
    sslMode?: string, 
    sslCertificate?: string, 
    sslCertificateKey?: string, 
    target?: string, 
    type?: string, 
    projectPath?: string, 
    owner?: string
): Promise<void> {
    const db = await dbPromise;
    try {
        const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
        if (existingDomain) {
            throw new Error(`The domain ${domain} already exists.`);
        }
        await db.run(
            'INSERT INTO domains (domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner]);
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `register the domain ${domain} in the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.error(`Error adding domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to get all domains
 */
export async function getDomains(): Promise<DomainRecord[]> {
    try {
        const db = await dbPromise;
        return await db.all('SELECT * FROM domains');
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                'get the list of domains from the database',
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has read permissions for the current user.`
            );
        }
        console.error('Error getting domains:', error);
        throw error;
    }
}

/**
 * Function to get a domain by its name
 */
export async function getDomainByName(domain: string): Promise<DomainRecord | undefined> {
    try {
        const db = await dbPromise;
        return await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `get the domain ${domain} from the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has read permissions for the current user.`
            );
        }
        console.error(`Error getting the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to update a domain
 */
export async function updateDomain(
    domain: string, 
    subdomain?: string, 
    email?: string, 
    sslMode?: string, 
    sslCertificate?: string, 
    sslCertificateKey?: string, 
    target?: string, 
    type?: string, 
    projectPath?: string, 
    owner?: string
): Promise<void> {
    try {
        const db = await dbPromise;
        await db.run(
            'UPDATE domains SET subdomain = ?, email = ?, sslMode = ?, sslCertificate = ?, sslCertificateKey = ?, target = ?, type = ?, projectPath = ?, owner = ? WHERE domain = ?',
            [subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner, domain]
        );
    }
    catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `update the domain ${domain} in the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.error(`Error updating the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to update the target of a domain
 */
export async function updateDomainTarget(domain: string, target: string): Promise<void> {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET target = ? WHERE domain = ?', [target, domain]);
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `update the target of the domain ${domain} in the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.error(`Error updating the target of the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to update the type of a domain
 */
export async function updateDomainType(domain: string, type: string): Promise<void> {
    try {
        const db = await dbPromise;
        await db.run('UPDATE domains SET type = ? WHERE domain = ?', [type, domain]);
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `update the type of the domain ${domain} in the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.error(`Error updating the type of the domain ${domain}:`, error);
        throw error;
    }
}

export async function getDomainTarget(domain: string): Promise<string | undefined> {
    try {
        const db = await dbPromise;
        const row = await db.get('SELECT target FROM domains WHERE domain = ?', [domain]);
        return row ? row.target : undefined;
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `get the target of the domain ${domain} from the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has read permissions for the current user.`
            );
        }
        console.error(`Error getting the target of the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to delete a domain
 */
export async function deleteDomain(domain: string): Promise<void> {
    try {
        const db = await dbPromise;
        await db.run('DELETE FROM domains WHERE domain = ?', [domain]);
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `delete the domain ${domain} from the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.error(`Error deleting the domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to store configuration in the database
 */
export async function storeConfigInDB(
    domain: string, 
    subdomain?: string, 
    sslMode?: string, 
    sslCertificate?: string, 
    sslCertificateKey?: string, 
    target?: string, 
    type?: string, 
    projectPath?: string, 
    owner?: string
): Promise<void> {
    const db = await dbPromise;
    try {
        const existingDomain = await db.get('SELECT * FROM domains WHERE domain = ?', [domain]);
        const domainOwner = owner || domain.split('.').slice(-2).join('.');
        if (existingDomain) {
            await db.run('UPDATE domains SET subdomain = ?, sslMode = ?, sslCertificate = ?, sslCertificateKey = ?, target = ?, type = ?, projectPath = ?, owner = ? WHERE domain = ?', [subdomain, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, domainOwner, domain]);
        } else {
            await db.run('INSERT INTO domains (domain, subdomain, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [domain, subdomain, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, domainOwner]);
        }
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `store the configuration of the domain ${domain} in the database`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.error(`Error storing config for domain ${domain}:`, error);
        throw error;
    }
}

/**
 * Function to write existing Nginx configurations to the database
 */
export async function writeExistingNginxConfigs(): Promise<void> {
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
    } catch (error: any) {
        if (
            error.code === 'EACCES' ||
            error.code === 'SQLITE_CANTOPEN' ||
            error.message?.includes('permission') ||
            error.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                'read or write nginx configurations in the database',
                `chmod 755 ${sqliteDatabasePath} && chmod 755 /etc/nginx/XBlocks-available/`,
                `Make sure the files in /etc/nginx/XBlocks-available/ and ${sqliteDatabasePath} have read/write permissions for the current user.`
            );
        }
        console.error('Error writing existing nginx configs:', error);
        throw error;
    }
}

/**
 * Function to get the configuration of a domain
 */
function getConfig(domain: string): Promise<DomainConfigResult | undefined> {
    return new Promise(async (resolve, reject) => {
        const db = new Database(sqliteDatabasePath);
        try {
            const row = await db.get(
                'SELECT domain, type, port, sslCertificate, sslCertificateKey AS target FROM domains WHERE domain = ? OR domain = ?',
                [domain, '*.' + domain.split('.').slice(1).join('.')]
            );
            await db.close();
            resolve(row);
        } catch (err) {
            await db.close();
            reject(err);
        }
    });
}

/**
 * Updates the SSL certificate paths in the database for a domain.
 */
export async function updateSSLCertificatePaths(domain: string, certPath: string, keyPath: string): Promise<void> {
    const db = new Database(sqliteDatabasePath);
    try {
        await db.run(
            `UPDATE domains SET 
                sslCertificate = ?,
                sslCertificateKey = ?
             WHERE domain = ?`,
            [certPath, keyPath, domain]
        );
        await db.close();
    } catch (err: any) {
        await db.close();
        if (
            err.message?.includes('permission') ||
            (err as any).code === 'EACCES' ||
            (err as any).code === 'SQLITE_CANTOPEN' ||
            err.message?.includes('SQLITE_CANTOPEN')
        ) {
            await handlePermission(
                `update the SSL certificate paths for the domain ${domain}`,
                `chmod 755 ${sqliteDatabasePath}`,
                `Make sure the file ${sqliteDatabasePath} has write permissions for the current user.`
            );
        }
        console.log('Error updating SSL certificate paths in database:', err.message);
        throw err;
    }
}

export default { getConfig };
export type { DomainRecord, DomainConfigResult };