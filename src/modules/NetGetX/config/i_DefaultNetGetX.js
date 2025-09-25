//i_DefaultNetGetX.js
import fs from 'fs';
import chalk from 'chalk';
import { loadOrCreateXConfig, saveXConfig } from './xConfig.js';
import { initializeState } from '../xState.js';
import { getLocalIP, getPublicIP } from '../../utils/ipUtils.js';
import { pathExists } from '../../utils/pathUtils.js';
import { initializeDirectories, getDirectoryPaths } from '../../utils/GETDirs.js';
import { checkSelfSignedCertificates, generateSelfSignedCert } from '../Domains/SSL/selfSignedCertificates.js';
import { checkLocalHostEntryExists, addLocalHostEntry } from '../../utils/localHosts.js';
import verifyOpenRestyInstallation from '../OpenResty/verifyOpenRestyInstallation.js';
import openRestyInstallationOptions from '../OpenResty/openRestyInstallationOptions.cli.js';
import { ensureNginxConfigFile, setNginxConfigFile } from '../OpenResty/setNginxConfigFile.js';

/**
 * Sets default paths for NGINX and other directories if they are not already set.
 * @memberof module:NetGetX.Config
 * @returns {Promise<Object>} The updated user configuration object.
 */
async function i_DefaultNetGetX() {
    try {
        initializeDirectories(); // Initialize all necessary directories
        let DEFAULT_DIRECTORIES = getDirectoryPaths(); // Get paths to .get default directories
        let xConfig = await loadOrCreateXConfig();

        const entry = '127.0.0.1 local.netget';
        if (!checkLocalHostEntryExists(entry)) {
            console.log(chalk.blue(`Entry does not exist, adding: ${entry}`));
            await addLocalHostEntry(entry);
        }

        console.log(`Host: ${chalk.blue(entry)}`);

        // Self-signed certificates validation
        try {
            const getSelfSignedCertificates = await checkSelfSignedCertificates();
            if (!getSelfSignedCertificates) {
                console.log(chalk.blue('Self-signed certificates not found, generating new ones.'));
                await generateSelfSignedCert();
            } else {
                console.log(chalk.blue('Self-signed certificates already exist.'));
                console.log(' ');
            }
        } catch (certError) {
            console.log(chalk.yellow(`Warning: SSL certificate operations failed: ${certError.message}`));
        }

        // OpenResty installation validation
        try {
            let openRestyInstalled = verifyOpenRestyInstallation();
            if (!openRestyInstalled) {
                console.log(chalk.yellow("OpenResty is not installed. Redirecting to installation options..."));
                await openRestyInstallationOptions();
                openRestyInstalled = verifyOpenRestyInstallation();
                if (!openRestyInstalled) {
                    console.log(chalk.red("OpenResty still not detected after installation attempt. Please manually install OpenResty and retry."));
                    return false;
                } else {
                    console.log(chalk.green("OpenResty installed successfully."));
                }
            }
        } catch (openRestyError) {
            console.log(chalk.red(`Error with OpenResty operations: ${openRestyError.message}`));
            return false;
        }

        const validateNginxConfig = () => {
            if (fs.existsSync(nginxConfigPath)) {
                const existingContent = fs.readFileSync(nginxConfigPath, 'utf8');
                return existingContent === nginxConfigContent;
            }
            return false;
        };

        // NGINX configuration file validation
        try {
            const nginxConfigPath = '/usr/local/openresty/nginx/conf/nginx.conf';
            if (!pathExists(nginxConfigPath)) {
                await ensureNginxConfigFile();
                if (!pathExists(nginxConfigPath) & validateNginxConfig()) {
                    await setNginxConfigFile();
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    await ensureNginxConfigFile();
                }
            }
        } catch (nginxError) {
            console.log(chalk.yellow(`Warning: NGINX configuration operations failed: ${nginxError.message}`));
        }

        /*
         ┏┓┏┓┏┳┓
         ┃┓┣  ┃ 
        •┗┛┗┛ ┻ 
        Verify .get Paths  
         */
        try {
            if (!xConfig.getPath) {
                const getDefaultPath = DEFAULT_DIRECTORIES.getPath;
                if (pathExists(getDefaultPath)) {
                    await saveXConfig({ getPath: getDefaultPath });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    console.log(`Default getPath does not exist: ${getDefaultPath}, not updating configuration.`);
                }
            }

            if (!xConfig.static) {
                const getDefaultStatic = DEFAULT_DIRECTORIES.static;
                if (pathExists(getDefaultStatic)) {
                    await saveXConfig({ static: getDefaultStatic });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    console.log(`Default static does not exist: ${getDefaultStatic}, not updating configuration.`);
                }
            }

            if (!xConfig.devPath) {
                const getDefaultDevPath = DEFAULT_DIRECTORIES.devPath;
                if (pathExists(getDefaultDevPath)) {
                    //console.log(`Default devPath exists: ${getDefaultDevPath}`);
                    await saveXConfig({ devPath: getDefaultDevPath });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                    //console.log(`devPath updated in configuration.`);
                } else {
                    console.log(`Default devPath does not exist: ${getDefaultDevPath}, not updating configuration.`);
                }
            }

            if (!xConfig.devStatic) {
                const getDefaultDevStatic = DEFAULT_DIRECTORIES.devStatic;
                if (pathExists(getDefaultDevStatic)) {
                    await saveXConfig({ devStatic: getDefaultDevStatic });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    console.log(`Default devStatic does not exist: ${getDefaultDevStatic}, not updating configuration.`);
                }
            }
        } catch (pathError) {
            console.log(chalk.yellow(`Warning: Path configuration operations failed: ${pathError.message}`));
        }

        /*
        ╔═╗╔═╗╦═╗╔╦╗╔═╗
        ╠═╝║ ║╠╦╝ ║ ╚═╗
        ╩  ╚═╝╩╚═ ╩ ╚═╝*/
        try {
            if (!xConfig.xMainOutPutPort) {
                await saveXConfig({ xMainOutPutPort: 3432 });
                xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
            }
        } catch (portError) {
            console.log(chalk.yellow(`Warning: Port configuration failed: ${portError.message}`));
        }

        try {
            const publicIP = await getPublicIP();  // Properly await the asynchronous call
            const localIP = getLocalIP();
            if (publicIP != xConfig.publicIP) {
                console.log("PublicIP has changed from: " + xConfig.publicIP + " new Detected: " + publicIP);
                await saveXConfig({ publicIP: publicIP });
                xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
            };

            if (localIP != xConfig.localIP) {
                console.log("LocalIP has changed from: " + xConfig.localIP + " new Detected: " + localIP);
                await saveXConfig({ localIP: localIP });
                xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
            };
        } catch (ipError) {
            console.log(chalk.yellow(`Warning: IP detection/configuration failed: ${ipError.message}`));
        }

        let x = {
            ...xConfig // spreads all properties of xConfig into x
        };

        initializeState(x);
        return x;

    } catch (error) {
        console.log(chalk.red(`Critical error in i_DefaultNetGetX: ${error.message}`));
        console.log(chalk.red(`Stack trace: ${error.stack}`));
        
        // Return a basic configuration object to prevent complete failure
        try {
            const fallbackConfig = await loadOrCreateXConfig();
            return fallbackConfig;
        } catch (fallbackError) {
            console.log(chalk.red(`Fallback configuration loading also failed: ${fallbackError.message}`));
            return {};
        }
    }
};

export { i_DefaultNetGetX };