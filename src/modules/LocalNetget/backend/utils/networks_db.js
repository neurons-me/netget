import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

const CONFIG_DIR = path.join('/opt/', '.get');
const NETWORKS_DB_FILE = path.join(CONFIG_DIR, 'networks.db');

/**
 * Ensure the config directory exists
 */
function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

/**
 * Function to create the networks table in the database
 * @returns {Promise<void>}
 */
async function createNetworksTable() {
    ensureConfigDir();
    
    const db = await open({
        filename: NETWORKS_DB_FILE,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS networks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            ip TEXT NOT NULL,
            owner TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.close();
}

/**
 * Function to initialize the networks database
 * @returns {Promise<sqlite3.Database>}
 */
export async function initializeNetworksDatabase() {
    await createNetworksTable();
    return open({
        filename: NETWORKS_DB_FILE,
        driver: sqlite3.Database
    });
}

const networksDbPromise = initializeNetworksDatabase();

/**
 * Function to add a network
 * @param {string} name - The network name
 * @param {string} ip - The IP address
 * @param {string} owner - The owner of the network
 * @returns {Promise<Object>}
 */
export async function addNetwork(name, ip, owner) {
    const db = await networksDbPromise;
    try {
        const existingNetwork = await db.get('SELECT * FROM networks WHERE name = ?', [name]);
        if (existingNetwork) {
            throw new Error(`A network with the name "${name}" already exists.`);
        }
        
        const result = await db.run(
            'INSERT INTO networks (name, ip, owner) VALUES (?, ?, ?)',
            [name, ip, owner]
        );
        
        // Return the newly created network
        return await db.get('SELECT * FROM networks WHERE id = ?', [result.lastID]);
    } catch (error) {
        console.error(`Error adding network ${name}:`, error);
        throw error;
    }
}

/**
 * Function to get all networks
 * @returns {Promise<Array>}
 */
export async function getAllNetworks() {
    try {
        const db = await networksDbPromise;
        return await db.all('SELECT * FROM networks ORDER BY created_at DESC');
    } catch (error) {
        console.error('Error getting networks:', error);
        throw error;
    }
}

/**
 * Function to get a network by its name
 * @param {string} name - The network name
 * @returns {Promise<Object>}
 */
export async function getNetworkByName(name) {
    try {
        const db = await networksDbPromise;
        return await db.get('SELECT * FROM networks WHERE name = ?', [name]);
    } catch (error) {
        console.error(`Error getting network ${name}:`, error);
        throw error;
    }
}

/**
 * Function to get a network by its ID
 * @param {number} id - The network ID
 * @returns {Promise<Object>}
 */
export async function getNetworkById(id) {
    try {
        const db = await networksDbPromise;
        return await db.get('SELECT * FROM networks WHERE id = ?', [id]);
    } catch (error) {
        console.error(`Error getting network with ID ${id}:`, error);
        throw error;
    }
}

/**
 * Function to update a network
 * @param {string} name - The current network name
 * @param {Object} updates - Object containing the fields to update
 * @returns {Promise<Object>}
 */
export async function updateNetwork(name, updates) {
    try {
        const db = await networksDbPromise;
        
        const allowedFields = ['name', 'ip', 'owner'];
        const fieldsToUpdate = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fieldsToUpdate.push(`${key} = ?`);
                values.push(value);
            }
        }
        
        if (fieldsToUpdate.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        // Add updated_at timestamp
        fieldsToUpdate.push('updated_at = CURRENT_TIMESTAMP');
        values.push(name); // Add the WHERE condition value
        
        await db.run(
            `UPDATE networks SET ${fieldsToUpdate.join(', ')} WHERE name = ?`,
            values
        );
        
        // Return the updated network
        const updatedName = updates.name || name;
        return await getNetworkByName(updatedName);
    } catch (error) {
        console.error(`Error updating network ${name}:`, error);
        throw error;
    }
}

/**
 * Function to delete a network by name
 * @param {string} name - The network name
 * @returns {Promise<boolean>}
 */
export async function deleteNetwork(name) {
    try {
        const db = await networksDbPromise;
        const result = await db.run('DELETE FROM networks WHERE name = ?', [name]);
        return result.changes > 0;
    } catch (error) {
        console.error(`Error deleting network ${name}:`, error);
        throw error;
    }
}

/**
 * Function to check if a network exists
 * @param {string} name - The network name
 * @returns {Promise<boolean>}
 */
export async function networkExists(name) {
    try {
        const network = await getNetworkByName(name);
        return !!network;
    } catch (error) {
        console.error(`Error checking if network ${name} exists:`, error);
        return false;
    }
}

/**
 * Function to get networks count
 * @returns {Promise<number>}
 */
export async function getNetworksCount() {
    try {
        const db = await networksDbPromise;
        const result = await db.get('SELECT COUNT(*) as count FROM networks');
        return result.count;
    } catch (error) {
        console.error('Error getting networks count:', error);
        throw error;
    }
}

/**
 * Function to migrate networks from localStorage format to database
 * This is useful for existing installations
 * @param {Object} networksData - Networks data from localStorage
 * @returns {Promise<Array>}
 */
export async function migrateNetworksFromLocalStorage(networksData) {
    try {
        const migratedNetworks = [];
        
        if (networksData && networksData.networks) {
            for (const [name, networkInfo] of Object.entries(networksData.networks)) {
                try {
                    // Check if network already exists in database
                    const exists = await networkExists(name);
                    if (!exists) {
                        const network = await addNetwork(
                            name,
                            networkInfo.ip,
                            networkInfo.owner
                        );
                        migratedNetworks.push(network);
                    }
                } catch (error) {
                    console.error(`Error migrating network ${name}:`, error);
                }
            }
        }
        
        return migratedNetworks;
    } catch (error) {
        console.error('Error migrating networks from localStorage:', error);
        throw error;
    }
}
