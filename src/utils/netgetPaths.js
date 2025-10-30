import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tryEnsureDir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    } catch (error) {
        return null;
    }
}

function canWriteToDir(dir) {
    const ensuredDir = tryEnsureDir(dir);
    if (!ensuredDir) {
        return false;
    }

    const testPath = path.join(ensuredDir, '.netget-write-test');
    try {
        const handle = fs.openSync(testPath, 'a');
        fs.closeSync(handle);
        fs.unlinkSync(testPath);
        return true;
    } catch (error) {
        try {
            fs.unlinkSync(testPath);
        } catch {
            // ignore cleanup errors
        }
        return false;
    }
}

function resolveDataDir() {
    const osName = os.platform();
    const homeDir = os.homedir();

    if (osName === 'linux') {
        const optPath = '/opt/.get';
        if (canWriteToDir(optPath)) {
            return optPath;
        }

        const homePath = path.join(homeDir, '.get');
        if (canWriteToDir(homePath)) {
            return homePath;
        }
    } else if (osName === 'darwin') {
        const homePath = path.join(homeDir, '.get');
        if (canWriteToDir(homePath)) {
            return homePath;
        }
    } else if (osName === 'win32') {
        const appDataPath = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
        const netgetPath = path.join(appDataPath, 'NetGet');
        if (canWriteToDir(netgetPath)) {
            return netgetPath;
        }
    }

    throw new Error('Unable to determine a writable NetGet data directory.');
}

const DATA_DIR = resolveDataDir();
const HTML_ROOT = path.join(DATA_DIR, 'html');

function ensureHtmlDir() {
    tryEnsureDir(HTML_ROOT);
}

export function getNetgetDataDir() {
    return DATA_DIR;
}

export function getHtmlRootDir() {
    ensureHtmlDir();
    return HTML_ROOT;
}
