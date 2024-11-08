// netget/src/scripts/init_dirs.js
import path from 'path';
import os from 'os';
import { ensureDirectoryExists, Path_Exists } from './pathUtils.js';

const BASE_DIR = path.join('/home/bongi/','.get');
const DIRECTORIES = {
    getPath: BASE_DIR,
    static: path.join(BASE_DIR, 'static'),
    devPath: path.join(BASE_DIR, 'dev'),
    devStatic: path.join(BASE_DIR, 'dev', 'static'),
    gatewayPath: path.join(BASE_DIR, 'Gateways'),
};

/* Safety and Non-Destructive Behavior
No Deletion or Overwriting: The script does not contain any commands to delete or overwrite files or directories.
 The fs.mkdirSync() function only creates directories; it does not modify or delete existing files or directories.
Preservation of Existing Content: If a directory already exists, fs.mkdirSync() with { recursive: true } does nothing to that directory or its contents. 
It simply moves on without changing anything in the existing directory structure.*/

/**
 * Initializes all necessary directories and checks their permissions.
 */
function initializeDirectories() {
    Object.values(DIRECTORIES).forEach(dir => {
        ensureDirectoryExists(dir);
        // Optional: Check and correct permissions after creation
        // checkPermissions(dir, 0o755); // Uncomment if needed
    });
}

/**
 * Verifies that all necessary directories exist.
 * @returns {boolean} True if all directories exist, false otherwise.
 */
function verifyInitialization() {
    const initStatus = {};
    Object.values(DIRECTORIES).forEach(dir => {
        try {
            ensureDirectoryExists(dir);
            initStatus[dir] = Path_Exists(dir);
        } catch (error) {
            initStatus[dir] = false;
        }
    });

    const allDirsInitialized = Object.values(initStatus).every(status => status);
    if (allDirsInitialized) {
        console.log(".get successfully initialized.");
    } else {
        console.error(".get failed to initialize:", initStatus);
    }

    return allDirsInitialized;
}

/**
 * Get paths to important directories.
 * @returns {object} Object containing paths to key directories.
 * @category Utils
 * @subcategory General
 * @module GETDirs
 */
function getDirectoryPaths() {
    return DIRECTORIES;
}

export { initializeDirectories, verifyInitialization, getDirectoryPaths };
