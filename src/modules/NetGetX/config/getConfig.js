/**
 * @file getConfig.js
 * @description This module provides a function to read and parse a JSON configuration file.
 * @module NetGetX/config/getConfig
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join('/opt/', '.get');
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'xConfig.json');

/**
 * Reads the user configuration file and parses it as JSON.
 * 
 * @async
 * @function getConfig
 * @returns {Promise<Object>} The parsed configuration object. If an error occurs, an empty object is returned.
 * @throws Will log an error message if reading the file fails.
 */
async function getConfig() {
    try {
        const data = await fs.readFile(USER_CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading xConfig.json:', err);
        return {};
    }
}

export { getConfig };
