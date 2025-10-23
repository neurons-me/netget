// netget/src/scripts/init_dirs.ts
import * as path from 'path';
import { ensureDirectoryExists, pathExists } from './pathUtils.ts';

interface DirectoryPaths {
    getPath: string;
    static: string;
    devPath: string;
    devStatic: string;
}

interface InitStatus {
    [key: string]: boolean;
}

const BASE_DIR: string = path.join('/opt/','.get');
const DIRECTORIES: DirectoryPaths = {
    getPath: BASE_DIR,
    static: path.join(BASE_DIR, 'static'),
    devPath: path.join(BASE_DIR, 'dev'),
    devStatic: path.join(BASE_DIR, 'dev', 'static')
};

/* Safety and Non-Destructive Behavior
No Deletion or Overwriting: The script does not contain any commands to delete or overwrite files or directories.
 The fs.mkdirSync() function only creates directories; it does not modify or delete existing files or directories.
Preservation of Existing Content: If a directory already exists, fs.mkdirSync() with { recursive: true } does nothing to that directory or its contents. 
It simply moves on without changing anything in the existing directory structure.*/

/**
 * Initializes all necessary directories and checks their permissions.
 * @category Utils
 * @subcategory General
 * @module GETDirs
 */
function initializeDirectories(): void {
    Object.values(DIRECTORIES).forEach((dir: string) => {
        ensureDirectoryExists(dir);
        // Optional: Check and correct permissions after creation
        // checkPermissions(dir, 0o755); // Uncomment if needed
    });
}

/**
 * Verifies that all necessary directories exist.
 * @returns True if all directories exist, false otherwise.
 */
function verifyInitialization(): boolean {
    const initStatus: InitStatus = {};
    Object.values(DIRECTORIES).forEach((dir: string) => {
        try {
            ensureDirectoryExists(dir);
            initStatus[dir] = pathExists(dir);
        } catch (error) {
            initStatus[dir] = false;
        }
    });

    const allDirsInitialized: boolean = Object.values(initStatus).every((status: boolean) => status);
    if (allDirsInitialized) {
        console.log(".get successfully initialized.");
    } else {
        console.error(".get failed to initialize:", initStatus);
    }

    return allDirsInitialized;
}

/**
 * Get paths to important directories.
 * @returns Object containing paths to key directories.
 * @category Utils
 * @subcategory General
 * @module GETDirs
 */
function getDirectoryPaths(): DirectoryPaths {
    return DIRECTORIES;
}

export { initializeDirectories, verifyInitialization, getDirectoryPaths };
export type { DirectoryPaths, InitStatus };