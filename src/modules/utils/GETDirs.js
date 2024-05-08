//netget/src/modules/utils/GETDirs.js
import path from 'path';
import os from 'os';
import { ensureDirectoryExists } from './pathUtils.js';

const BASE_DIR = path.join(os.homedir(), '.get');
const DIRECTORIES = {
    getPath: BASE_DIR,
    static: path.join(BASE_DIR, 'static'),
    staticDefault: path.join(BASE_DIR, 'static', 'default'),
    SSLPath: path.join(BASE_DIR, 'ssl'),
    SSLCertificatesPath: path.join(BASE_DIR, 'ssl', 'certificates'),
    SSLCertificateKeyPath: path.join(BASE_DIR, 'ssl', 'key'),
    devPath: path.join(BASE_DIR, 'dev'),
    devStatic: path.join(BASE_DIR, 'dev', 'static'),
    devStaticDefault: path.join(BASE_DIR, 'dev', 'static', 'default'),
    devSSLPath: path.join(BASE_DIR, 'dev', 'ssl'),
    devSSLCertificatesPath: path.join(BASE_DIR, 'dev', 'ssl', 'certificates'),
    devSSLCertificateKeyPath: path.join(BASE_DIR, 'dev', 'ssl', 'key'),
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
 * Get paths to important directories.
 * @returns {object} Object containing paths to key directories.
 */
function getDirectoryPaths() {
    return DIRECTORIES;
}

export { initializeDirectories, getDirectoryPaths };
