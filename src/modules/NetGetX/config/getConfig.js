import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_DIR = path.join('/opt/', '.get');
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'xConfig.json');

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
