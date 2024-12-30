import os from 'os';
import chalk from 'chalk';
import { exec } from 'child_process';
import { execShellCommand } from '../../utils/execShellCommand.js';  

/**
 * Checks if Chocolatey is installed on Windows.
 * @returns {Promise<boolean>} - Returns true if Chocolatey is installed, otherwise false.
 * @category NetGetX
 * @subcategory NGINX
 * @module installNginx
    */
const checkForChoco = () => {
    return new Promise((resolve, reject) => {
        exec('choco', (error, stdout, stderr) => {
            if (stderr && stderr.includes('is not recognized')) {
                resolve(false);  // Chocolatey is not installed.
            } else {
                resolve(true);  // Chocolatey is installed or another error not related to existence.
            }
        });
    });
};
/** Determine the appropriate installation command based on the OS. 
* @param {string} version - The version of NGINX to install.
* @returns {string|null} - The installation command for the OS or null if unsupported.
* @category NetGetX
* @subcategory NGINX
* @module installNginx
**/
const determineInstallCommand = (version) => {
    switch (os.platform()) {
        case 'darwin': return 'brew install nginx';
        case 'linux': return 'sudo apt-get install nginx -y';
        case 'win32': return 'choco install nginx';
        default: return null;  // Unsupported OS
    }
};

/**
 * Installs NGINX on the system.
 * @returns {Promise<boolean>} - Returns true if installation was successful, otherwise false.
 * @category NetGetX
 * @subcategory NGINX
 * @module installNginx
 **/
const installNginx = async () => {
    if (os.platform() === 'win32' && !await checkForChoco()) {
        console.error(chalk.yellow('Chocolatey is not installed. Please install Chocolatey or install NGINX manually.'));
        return false;
    }

    const installCmd = determineInstallCommand();
    if (!installCmd) {
        console.error(chalk.red('Unsupported operating system for automatic installation.'));
        return false;
    }

    console.log(chalk.blue(`Using command: ${installCmd}`));
    try {
        await execShellCommand(installCmd);
        console.log(chalk.green("NGINX installation complete."));
        return true;
    } catch (error) {
        return await handleInstallationError(installCmd, error);
    }
};

/**
 * Handles errors encountered during installation.
 * @param {string} installCmd - The installation command that failed.
 * @param {Error} error - The error object thrown during installation.
 * @returns {boolean} - Returns true if the error is non-fatal, otherwise false. 
 * @category NetGetX
 * @subcategory NGINX
 * @module installNginx
**/
const handleInstallationError = async (installCmd, error) => {
    // Log the error and provide OS-specific advice
    console.error(chalk.red(`Installation error encountered: ${error.message}`));

    switch (os.platform()) {
        case 'darwin':
            return handleDarwinError(installCmd, error);
        case 'linux':
            return handleLinuxError(installCmd, error);
        case 'win32':
            return handleWindowsError(installCmd, error);
        default:
            console.error(chalk.red('Error handling not available for this OS.'));
            return false;
    }
};

/**
 * Handles errors specific to macOS.
 * @param {string} installCmd - The installation command that failed.
 * @param {Error} error - The error object thrown during installation.
 * @returns {boolean} - Returns true if the error is non-fatal, otherwise false.
 * @category NetGetX
 * @subcategory NGINX
 * @module installNginx
 * */
const handleDarwinError = (installCmd, error) => {
    if (error.message.includes('Permission denied')) {
        console.log(chalk.cyan("Homebrew might need permissions to write to its directories. This error may not be fatal, proceeding with setup."));
        return true; // Continue as this might not be fatal
    } else {
        suggestHomebrewFix();
        return false;
    }
};

/**
 * Handles errors specific to Linux.
 * @param {string} installCmd - The installation command that failed.
 * @param {Error} error - The error object thrown during installation.
 * @returns {boolean} - Returns true if the error is non-fatal, otherwise false.
 * @category NetGetX
 * @subcategory NGINX
 * @module installNginx
 * */
const handleLinuxError = (installCmd, error) => {
    if (error.message.toLowerCase().includes('permission denied')) {
        console.log(chalk.cyan("Try running the command with sudo or adjust permissions as necessary. Error may not halt setup."));
        return true; // Proceed conditionally
    } else {
        suggestLinuxFix(installCmd);
        return false;
    }
};

/**
 * Handles errors specific to Windows.
 * @param {string} installCmd - The installation command that failed.
 * @param {Error} error - The error object thrown during installation.
 * @returns {boolean} - Returns true if the error is non-fatal, otherwise false.
 * @category NetGetX
 * @subcategory NGINX
 * @module installNginx
 * */
const handleWindowsError = (installCmd, error) => {
    if (error.message.toLowerCase().includes('permission denied')) {
        console.log(chalk.cyan("Check if you have administrative privileges to run the installation. Error may not halt setup."));
        return true; // Proceed conditionally
    } else {
        suggestWindowsFix(installCmd);
        return false;
    }
};


const suggestHomebrewFix = () => {
    console.log(chalk.cyan("Ensure Homebrew is properly set up and has necessary permissions. Consider consulting Homebrew's troubleshooting guide."));
};

const suggestLinuxFix = (installCmd) => {
    console.log(chalk.cyan(`If issues persist, manually run '${installCmd}' or consult NGINX's Linux installation guide.`));
};

const suggestWindowsFix = (installCmd) => {
    console.log(chalk.cyan(`Ensure you have the necessary admin rights to run '${installCmd}' or check the installation steps for NGINX on Windows.`));
};

export default installNginx; 