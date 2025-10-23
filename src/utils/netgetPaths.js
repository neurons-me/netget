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
    const candidates = [];

    if (process.env.NETGET_DATA_DIR) {
        candidates.push(path.resolve(process.env.NETGET_DATA_DIR));
    }

    candidates.push(path.join('/opt', '.get'));

    const homeDir = os.homedir();
    if (homeDir) {
        candidates.push(path.join(homeDir, '.netget'));
    }

    candidates.push(path.join(PACKAGE_DIR, '.netget'));

    for (const dir of candidates) {
        if (canWriteToDir(dir)) {
            return dir;
        }
    }

    throw new Error('Unable to determine a writable NetGet data directory.');
}

const DATA_DIR = resolveDataDir();
const HTML_ROOT = path.join(DATA_DIR, 'html');
const DOMAINS_DB_PATH = path.join(DATA_DIR, 'domains.db');

ensureDomainsDbFile();

function ensureHtmlDir() {
    tryEnsureDir(HTML_ROOT);
}

function ensureDomainsDbFile() {
    if (!fs.existsSync(DOMAINS_DB_PATH)) {
        const handle = fs.openSync(DOMAINS_DB_PATH, 'a');
        fs.closeSync(handle);
    }
}

export function getNetgetDataDir() {
    return DATA_DIR;
}

export function getDomainsDbPath() {
    ensureDomainsDbFile();
    return DOMAINS_DB_PATH;
}

export function getHtmlRootDir() {
    ensureHtmlDir();
    return HTML_ROOT;
}
