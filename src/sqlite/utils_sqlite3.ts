
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
const { Database: SQLiteDatabase } = sqlite3;
import * as path from 'path';
import * as fs from 'fs';
import { handlePermission } from '../modules/utils/handlePermissions.ts';
import chalk from 'chalk';

const CONFIG_DIR: string = path.join('/opt/', '.get');
const USER_CONFIG_FILE: string = path.join(CONFIG_DIR, 'domains.db');

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
export async function createTable(): Promise<void> {
    try {
        console.log(chalk.green("Here is inside createTable() and before opening DB"));

        // Ensure the database file exists (open will create it but ensure directory exists first)
        try {
            if (!fs.existsSync(USER_CONFIG_FILE)) {
                fs.writeFileSync(USER_CONFIG_FILE, '', { mode: 0o644 });
            }
        } catch (touchErr: any) {
            console.error(chalk.red(`Failed to create database file ${USER_CONFIG_FILE}: ${touchErr.message}`));
            await handlePermission(
                `create the database file ${USER_CONFIG_FILE}`,
                `sudo touch ${USER_CONFIG_FILE} && sudo chown $(whoami) ${USER_CONFIG_FILE} && sudo chmod 644 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} exists and is writable by the current user.`
            );
            throw touchErr;
        }

        const db = await open({
            filename: USER_CONFIG_FILE,
            driver: SQLiteDatabase
        });

        console.log(chalk.green("Here is inside createTable() and before executing CREATE TABLE"));
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
        await handlePermission(
            'create the table in the database',
            `chmod 755 ${USER_CONFIG_FILE}`,
            `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
        );
        throw error;
    }
}

/**
 * Function to initialize the database
 */
export async function initializeDatabase(): Promise<Database> {
    console.log(chalk.green("Here is before createTable()"));
    await createTable();
    console.log(chalk.green("Here is after createTable()"));
    return open({
        filename: USER_CONFIG_FILE,
        driver: SQLiteDatabase
    });
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has read permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has read permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
            );
        }
        console.error(`Error updating the type of the domain ${domain}:`, error);
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE}`,
                `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
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
                `chmod 755 ${USER_CONFIG_FILE} && chmod 755 /etc/nginx/XBlocks-available/`,
                `Make sure the files in /etc/nginx/XBlocks-available/ and ${USER_CONFIG_FILE} have read/write permissions for the current user.`
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
    return new Promise((resolve, reject) => {
        const db = new SQLiteDatabase(USER_CONFIG_FILE);
        db.get('SELECT domain, type, port, sslCertificate, sslCertificateKey AS target FROM domains WHERE domain = ? OR domain = ?', [domain, '*.' + domain.split('.').slice(1).join('.')], (err: Error | null, row: DomainConfigResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

/**
 * Updates the SSL certificate paths in the database for a domain.
 */
export async function updateSSLCertificatePaths(domain: string, certPath: string, keyPath: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const db = new SQLiteDatabase('/opt/.get/domains.db');
        db.run(
            `UPDATE domains SET 
                sslCertificate = ?,
                sslCertificateKey = ?
             WHERE domain = ?`,
            [certPath, keyPath, domain],
            async (err: Error | null) => {
                db.close();
                if (err) {
                    if (
                        err.message?.includes('permission') ||
                        (err as any).code === 'EACCES' ||
                        (err as any).code === 'SQLITE_CANTOPEN' ||
                        err.message?.includes('SQLITE_CANTOPEN')
                    ) {
                        await handlePermission(
                            `update the SSL certificate paths for the domain ${domain}`,
                            `chmod 755 ${USER_CONFIG_FILE}`,
                            `Make sure the file ${USER_CONFIG_FILE} has write permissions for the current user.`
                        );
                    }
                    console.log('Error updating SSL certificate paths in database:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

export default { getConfig };
export type { DomainRecord, DomainConfigResult };