//i_DefaultNetGetX.ts
import * as fs from 'fs';
import chalk from 'chalk';
import { loadOrCreateXConfig, saveXConfig } from './xConfig.ts';
import type { XConfig } from './xConfig.ts';
import { initializeState } from '../xState.ts';
import type { XStateData } from '../xState.ts';
import { getLocalIP, getPublicIP } from '../../utils/ipUtils.ts';
import { pathExists } from '../../utils/pathUtils.ts';
import { initializeDirectories, getDirectoryPaths } from '../../utils/GETDirs.ts';
import type { DirectoryPaths } from '../../utils/GETDirs.ts';
import { checkSelfSignedCertificates, generateSelfSignedCert } from '../Domains/SSL/selfSignedCertificates.ts';
import { checkLocalHostEntryExists, addLocalHostEntry } from '../../utils/localHosts.ts';
import verifyOpenRestyInstallation from '../OpenResty/verifyOpenRestyInstallation.ts';
import openRestyInstallationOptions from '../OpenResty/openRestyInstallationOptions.cli.ts';
import { ensureNginxConfigFile, setNginxConfigFile } from '../OpenResty/setNginxConfigFile.ts';

/**
 * Sets default paths for NGINX and other directories if they are not already set.
 * @memberof module:NetGetX.Config
 * @returns The updated user configuration object.
 */
async function i_DefaultNetGetX(): Promise<XStateData | XConfig | {}> {
    try {
        initializeDirectories(); // Initialize all necessary directories
        let DEFAULT_DIRECTORIES: DirectoryPaths = getDirectoryPaths(); // Get paths to .get default directories
        let xConfig: XConfig = await loadOrCreateXConfig();

        const entry: string = '127.0.0.1 local.netget';
        if (!checkLocalHostEntryExists(entry)) {
            console.log(chalk.blue(`Entry does not exist, adding: ${entry}`));
            await addLocalHostEntry(entry);
        }

        console.log(`Host: ${chalk.blue(entry)}`);

        // Self-signed certificates validation
        try {
            const getSelfSignedCertificates: boolean = await checkSelfSignedCertificates();
            if (!getSelfSignedCertificates) {
                console.log(chalk.blue('Self-signed certificates not found, generating new ones.'));
                await generateSelfSignedCert();
            } else {
                console.log(chalk.blue('Self-signed certificates already exist.'));
                console.log(' ');
            }
        } catch (certError: any) {
            console.log(chalk.yellow(`Warning: SSL certificate operations failed: ${certError.message}`));
        }

        // OpenResty installation validation
        try {
            let openRestyInstalled: boolean = await verifyOpenRestyInstallation();
            if (!openRestyInstalled) {
                console.log(chalk.yellow("OpenResty is not installed. Redirecting to installation options..."));
                await openRestyInstallationOptions();
                openRestyInstalled = await verifyOpenRestyInstallation();
                if (!openRestyInstalled) {
                    console.log(chalk.red("OpenResty still not detected after installation attempt. Please manually install OpenResty and retry."));
                    return false;
                } else {
                    console.log(chalk.green("OpenResty installed successfully."));
                }
            }
        } catch (openRestyError: any) {
            console.log(chalk.red(`Error with OpenResty operations: ${openRestyError.message}`));
            return false;
        }

        // NGINX configuration file validation
        try {
            const nginxConfigPath: string = '/usr/local/openresty/nginx/conf/nginx.conf';
            if (!pathExists(nginxConfigPath)) {
                await ensureNginxConfigFile();
                if (!pathExists(nginxConfigPath)) {
                    await setNginxConfigFile();
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    await ensureNginxConfigFile();
                }
            }
        } catch (nginxError: any) {
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
                const getDefaultPath: string = DEFAULT_DIRECTORIES.getPath;
                if (pathExists(getDefaultPath)) {
                    await saveXConfig({ getPath: getDefaultPath });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    console.log(`Default getPath does not exist: ${getDefaultPath}, not updating configuration.`);
                }
            }

            if (!xConfig.static) {
                const getDefaultStatic: string = DEFAULT_DIRECTORIES.static;
                if (pathExists(getDefaultStatic)) {
                    await saveXConfig({ static: getDefaultStatic });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    console.log(`Default static does not exist: ${getDefaultStatic}, not updating configuration.`);
                }
            }

            if (!xConfig.devPath) {
                const getDefaultDevPath: string = DEFAULT_DIRECTORIES.devPath;
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
                const getDefaultDevStatic: string = DEFAULT_DIRECTORIES.devStatic;
                if (pathExists(getDefaultDevStatic)) {
                    await saveXConfig({ devStatic: getDefaultDevStatic });
                    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
                } else {
                    console.log(`Default devStatic does not exist: ${getDefaultDevStatic}, not updating configuration.`);
                }
            }
        } catch (pathError: any) {
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
        } catch (portError: any) {
            console.log(chalk.yellow(`Warning: Port configuration failed: ${portError.message}`));
        }

        try {
            const publicIP: string | null = await getPublicIP();  // Properly await the asynchronous call
            const localIP: string | null = getLocalIP();
            if (publicIP && publicIP !== xConfig.publicIP) {
                console.log("PublicIP has changed from: " + xConfig.publicIP + " new Detected: " + publicIP);
                await saveXConfig({ publicIP: publicIP });
                xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
            }

            if (localIP && localIP !== xConfig.localIP) {
                console.log("LocalIP has changed from: " + xConfig.localIP + " new Detected: " + localIP);
                await saveXConfig({ localIP: localIP });
                xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
            }
        } catch (ipError: any) {
            console.log(chalk.yellow(`Warning: IP detection/configuration failed: ${ipError.message}`));
        }

        let x: XStateData = {
            ...xConfig // spreads all properties of xConfig into x
        };

        initializeState(x);
        return x;

    } catch (error: any) {
        console.log(chalk.red(`Critical error in i_DefaultNetGetX: ${error.message}`));
        console.log(chalk.red(`Stack trace: ${error.stack}`));
        
        // Return a basic configuration object to prevent complete failure
        try {
            const fallbackConfig: XConfig = await loadOrCreateXConfig();
            return fallbackConfig;
        } catch (fallbackError: any) {
            console.log(chalk.red(`Fallback configuration loading also failed: ${fallbackError.message}`));
            return {};
        }
    }
}

export { i_DefaultNetGetX };