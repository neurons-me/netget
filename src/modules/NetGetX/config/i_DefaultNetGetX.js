//i_DefaultNetGetX.js
import chalk from 'chalk';
import { loadOrCreateXConfig, saveXConfig } from './xConfig.js';
import { initializeState } from '../xState.js';
import { getLocalIP, getPublicIP } from '../../utils/ipUtils.js';
import { pathExists } from '../../utils/pathUtils.js';
import { initializeDirectories, getDirectoryPaths } from '../../utils/GETDirs.js';
import { generateSelfSignedCert, checkSelfSignedCertificates } from '../Domains/SSL/selfSignedCertificates.js';
import { checkLocalHostEntryExists, addLocalHostEntry } from '../../utils/localHosts.js';
import { verifyExpressInstallation, getExpressConfig } from '../Express/expressInstallationOptions.cli.js';

/**
 * Sets default paths for NGINX and other directories if they are not already set.
 * @returns {Promise<Object>} The updated user configuration object.
 * @example
 * i_DefaultNetGetX(); 
 * Returns the sate of the configuration object set in xConfig.js to x.
 * x = {
 *    getPath: '/var/www/html'...
 * @category NetGetX
 * @subcategory Config
 * @module i_DefaultNetGetX
 * */

export async function i_DefaultNetGetX() {
initializeDirectories(); // Initialize all necessary directories
let DEFAULT_DIRECTORIES = getDirectoryPaths(); // Get paths to .get default directories
let xConfig = await loadOrCreateXConfig();

const entry = '127.0.0.1 local.netget';
//console.log(chalk.blue(`Checking if entry exists in hosts: ${entry}`));
if (!checkLocalHostEntryExists(entry)) {
    console.log(chalk.blue(`Entry does not exist, adding: ${entry}`));
    await addLocalHostEntry(entry);
}
console.log(chalk.blue(`Host: ${entry}`));

if (!checkSelfSignedCertificates()) {
    console.log(chalk.blue('Self-signed certificates not found, generating new ones.'));
    await generateSelfSignedCert();
} else {
    console.log(chalk.blue('Self-signed certificates already exist.'));
}

/* EXPRESS
╔═╗┌─┐┌┬┐┬ ┬┌─┐
╠═╝├─┤ │ ├─┤└─┐
╩  ┴ ┴ ┴ ┴ ┴└─┘*/

// Verify and set express configuration paths
await verifyExpressInstallation();
await getExpressConfig();

/*
 ┏┓┏┓┏┳┓
 ┃┓┣  ┃ 
•┗┛┗┛ ┻ 
Verify .get Paths  
 */
if(!xConfig.getPath){
const getDefaultPath = DEFAULT_DIRECTORIES.getPath;
    if (pathExists(getDefaultPath)) {
        await saveXConfig({ getPath: getDefaultPath });
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
        } else {
        console.log(`Default getPath does not exist: ${getDefaultPath}, not updating configuration.`);
    }
}

if(!xConfig.static){
const getDefaultStatic = DEFAULT_DIRECTORIES.static;
    if (pathExists(getDefaultStatic)) {
        await saveXConfig({ static: getDefaultStatic });
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    } else {
        console.log(`Default static does not exist: ${getDefaultStatic}, not updating configuration.`);
    }
}  


if(!xConfig.devPath){
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

if(!xConfig.devStatic){
const getDefaultDevStatic = DEFAULT_DIRECTORIES.devStatic;
    if (pathExists(getDefaultDevStatic)) {
        await saveXConfig({ devStatic: getDefaultDevStatic });
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    } else {
        console.log(`Default devStatic does not exist: ${getDefaultDevStatic}, not updating configuration.`);
    }
}

/*
╔═╗╔═╗╦═╗╔╦╗╔═╗
╠═╝║ ║╠╦╝ ║ ╚═╗
╩  ╚═╝╩╚═ ╩ ╚═╝*/
if(!xConfig.xMainOutPutPort){
    await saveXConfig({ xMainOutPutPort: 3432 });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
}

const publicIP = await getPublicIP();  // Properly await the asynchronous call
const localIP = getLocalIP();
if(publicIP != xConfig.publicIP){
    console.log("PublicIP has changed from: " + xConfig.publicIP + " new Detected: " + publicIP);
    await saveXConfig({ publicIP: publicIP });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
};

if(localIP != xConfig.localIP){
    console.log("LocalIP has changed from: " + xConfig.localIP + " new Detected: " + localIP);
    await saveXConfig({ localIP: localIP });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
};

let x = {
    ...xConfig // spreads all properties of xConfig into x
};

initializeState(x);
return x;
};