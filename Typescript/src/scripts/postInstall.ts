// scripts/postInstall.ts
import { initializeDirectories } from './init_dirs.ts';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Verify the sqlite3 native addon loads correctly.
 * On systems where the prebuilt binary was compiled for a newer GLIBC than
 * the host provides (e.g. Node v24 prebuilts on Debian Bookworm / GLIBC 2.36),
 * the module will fail to load with a GLIBC version error.
 * In that case, rebuild from source against the local system libraries.
 */
function ensureSqlite3(): void {
    try {
        // Attempt to load the native addon — this will throw if GLIBC mismatch
        const sqlite3Path = resolve(__dirname, '../../node_modules/sqlite3');
        require(sqlite3Path);
        console.log('sqlite3 native addon: OK');
    } catch (err: any) {
        const isGlibcError = String(err?.message || '').includes('GLIBC') ||
                             String(err?.message || '').includes('version');
        if (!isGlibcError) throw err;

        console.warn('sqlite3 prebuilt binary is incompatible with this system GLIBC.');
        console.log('Rebuilding sqlite3 from source (requires gcc/python3)...');

        const pkgDir = resolve(__dirname, '../../');
        const result = spawnSync('npm', ['rebuild', 'sqlite3', '--build-from-source'], {
            cwd: pkgDir,
            stdio: 'inherit',
            shell: true,
        });

        if (result.status !== 0) {
            console.error('sqlite3 rebuild failed. Install build tools: apt install -y python3 make gcc');
            console.error('Then run: npm rebuild sqlite3 --build-from-source');
        } else {
            console.log('sqlite3 rebuilt successfully from source.');
        }
    }
}

function runPostInstall(): void {
    try {
        console.log('Initializing default .get directories...');
        initializeDirectories();
        console.log('All directories have been successfully initialized.');
    } catch (error: any) {
        console.error('Failed to initialize directories:', error);
    }

    ensureSqlite3();
}

runPostInstall();