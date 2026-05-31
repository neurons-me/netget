import { promises as fs } from 'fs';
import path from 'path';
import type { XConfig } from './xConfig.ts';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';

const CONFIG_DIR: string = getNetgetDataDir();
const USER_CONFIG_FILE: string = path.join(CONFIG_DIR, 'xConfig.json');

/**
 * Reads and returns the configuration from xConfig.json
 * @returns Promise<XConfig | {}> - The configuration object or empty object if error
 */
async function getConfig(): Promise<XConfig | {}> {
    try {
        const data: string = await fs.readFile(USER_CONFIG_FILE, 'utf8');
        return JSON.parse(data) as XConfig;
    } catch (err: any) {
        console.error('Error reading xConfig.json:', err);
        return {};
    }
}

export { getConfig };