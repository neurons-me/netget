// migrateTable.ts
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

interface Column {
    name: string;
    type: string;
}

/**
 * Function to migrate the table into a new schema.
 * @param {Array} columns - The columns to create in the new table.
 * @returns {Promise<void>}
 */
async function migrateTable(columns: Column[]): Promise<void> {
    //Configure the path to the configuration directory
    const CONFIG_DIR = path.join('/opt/', '.get');
    const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'domains.db');
    const db = await open({
        filename: USER_CONFIG_FILE,
        driver: sqlite3.Database
    });

    try {
        // Start a transaction
        await db.exec('BEGIN TRANSACTION');

        // Create a new table with the specified columns
        const columnsDefinition = columns.map(column => `${column.name} ${column.type}`).join(', ');
        await db.exec(`
            CREATE TABLE domains_new (
                ${columnsDefinition}
            )
        `);

        // Copy data from the old table to the new table
        const columnNames = columns.map(column => column.name).join(', ');

        console.log(columnNames);
        await db.exec(`
            INSERT INTO domains_new (${columnNames})
            SELECT ${columnNames}
            FROM domains
        `);

        // Drop the old table
        await db.exec('DROP TABLE domains');

        // Rename the new table to the original table name
        await db.exec('ALTER TABLE domains_new RENAME TO domains');

        // Commit the transaction
        await db.exec('COMMIT');
    } finally {
        await db.close();
    }
}

// UNCOMMENT THE FOLLOWING LINES TO RUN THE MIGRATION
/*
const columns: Column[] = [
    { name: 'domain', type: 'TEXT PRIMARY KEY' },
    { name: 'email', type: 'TEXT' },
    { name: 'sslMode', type: 'TEXT' },
    { name: 'sslCertificate', type: 'TEXT' },
    { name: 'sslCertificateKey', type: 'TEXT' },
    { name: 'target', type: 'TEXT' },
    { name: 'type', type: 'TEXT' },
    { name: 'projectPath', type: 'TEXT' }
];
migrateTable(columns).catch(err => {
    console.error(err);
});
*/

export { migrateTable, Column };
