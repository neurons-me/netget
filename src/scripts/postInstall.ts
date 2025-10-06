// scripts/postInstall.ts
import { initializeDirectories } from './init_dirs.js';  // Adjust the path as necessary depending on your project structure

/**
 * This script is executed after the package is installed.
 * It initializes the default directories for the project.
 * You can customize this script to perform other post-install tasks as needed.
 * 
 * @module postInstall
 * 
 */
function runPostInstall(): void {
    try {
        console.log('Initializing default .get directories...');
        initializeDirectories();  // This will create all necessary directories as defined in your GETDirs module
        console.log('All directories have been successfully initialized.');
    } catch (error: any) {
        console.error('Failed to initialize directories:', error);
    }
}

// Execute the post-install process
runPostInstall();