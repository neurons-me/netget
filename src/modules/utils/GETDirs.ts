//netget/src/modules/utils/GETDirs.ts
import * as path from 'path';
import { ensureDirectoryExists } from './pathUtils.ts';
import { get } from 'http';
import { getNetgetDataDir } from '../../utils/netgetPaths.js';

interface DirectoryPaths {
    getPath: string;
    static: string;
    devPath: string;
    devStatic: string;
    gatewayPath: string;
    routePath: string;
}

const BASE_DIR: string = getNetgetDataDir();
const DIRECTORIES: DirectoryPaths = {
    getPath: BASE_DIR,
    static: `${BASE_DIR}/static`,
    devPath: `${BASE_DIR}/dev`,
    devStatic: `${BASE_DIR}/dev/static`,
    gatewayPath: `${BASE_DIR}/Gateways`,
    // Routes directory needs to be created inside app directory
    routePath: `${BASE_DIR}/Routes`,
};

/* Safety and Non-Destructive Behavior
No Deletion or Overwriting: The script does not contain any commands to delete or overwrite files or directories.
 The fs.mkdirSync() function only creates directories; it does not modify or delete existing files or directories.
Preservation of Existing Content: If a directory already exists, fs.mkdirSync() with { recursive: true } does nothing to that directory or its contents. 
It simply moves on without changing anything in the existing directory structure.*/

/**
 * Initializes all necessary directories and checks their permissions.
 */
async function initializeDirectories(): Promise<void> {
    for (const dir of Object.values(DIRECTORIES)) {
        await ensureDirectoryExists(dir);
    }
}

/**
 * Get paths to important directories.
 * @returns Object containing paths to key directories.
 */
function getDirectoryPaths(): DirectoryPaths {
    return DIRECTORIES;
}

export { initializeDirectories, getDirectoryPaths };
export type { DirectoryPaths };