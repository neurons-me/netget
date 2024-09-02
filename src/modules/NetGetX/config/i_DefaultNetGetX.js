//i_DefaultNetGetX.js
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { 
    loadOrCreateXConfig,
    saveXConfig } from './xConfig.js';
import { initializeState } from '../xState.js';
import {
    getNginxConfigAndDir,
    setNginxConfigAndDir,
    setNginxExecutable } from './NginxPaths.js';
import { 
    getLocalIP,
    getPublicIP } from '../../utils/ipUtils.js';
import { 
    ensureDirectoryExists,
    Path_Exists } from '../../utils/pathUtils.js';
import { initializeDirectories,
         getDirectoryPaths } from '../../utils/GETDirs.js';
import verifyNginxInstallation from '../NGINX/verifyNginxInstallation.js';
import nginxInstallationOptions from '../NGINX/nginxInstallationOptions.cli.js'; 
import { generateSelfSignedCert, checkSelfSignedCertificates } from '../NGINX/selfSignedCertificates.js';
import verifyNginxConfig from './verifyNginxConfig.js';
import verifyServerBlock from '../mainServer/verifyServerBlock.js'; 
import handlePermissionErrorForEnsureDir from '../../utils/handlePermissionErrorForEnsureDir.js';
import { checkLocalHostEntryExists, addLocalHostEntry } from '../../utils/localHosts.js';

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

/* NGINX
╔═╗┌─┐┌┬┐┬ ┬┌─┐
╠═╝├─┤ │ ├─┤└─┐
╩  ┴ ┴ ┴ ┴ ┴└─┘*/
// Verify Installation
const nginxInstalled = verifyNginxInstallation();
if (!nginxInstalled) {
    console.log(chalk.yellow("NGINX is not installed. Redirecting to installation options..."));
    await nginxInstallationOptions();
    if (!verifyNginxInstallation()) {
        console.log(chalk.red("NGINX still not detected after installation attempt. Please manually install NGINX and retry."));
        return false;
    }
}
 // Verify and set NGINX configuration paths
if (!xConfig.nginxPath || !xConfig.nginxDir) {
const nginxPath = await getNginxConfigAndDir();
    if (nginxPath && nginxPath.configPath) {
        console.log(chalk.green(`Found NGINX configuration path: ${nginxPath.configPath}`));
        const setSuccess = await setNginxConfigAndDir(nginxPath.configPath, nginxPath.basePath);
        if (setSuccess) {
            xConfig = await loadOrCreateXConfig();
        } else {
            console.error(chalk.red(`Failed to set NGINX configuration paths.`));
        }
    } else {
        console.log(chalk.yellow(`NGINX configuration path not found.`));
    }
}
/* NGINX 
 ╔═╗═╗ ╦╔═╗╔═╗╦ ╦╔╦╗╔═╗╔╗ ╦  ╔═╗
 ║╣ ╔╩╦╝║╣ ║  ║ ║ ║ ╠═╣╠╩╗║  ║╣ 
 ╚═╝╩ ╚═╚═╝╚═╝╚═╝ ╩ ╩ ╩╚═╝╩═╝╚═╝
Check and set executable*/
if (!xConfig.nginxExecutable) {
    if (await setNginxExecutable(xConfig)) {
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
         }else{
        console.log(chalk.red('Failed to set NGINX executable.'));
        console.log(chalk.red('Please Make Sure NGINX Is Installed.'));
      }  
    } 

/*
 ┏┓┏┓┏┳┓
 ┃┓┣  ┃ 
•┗┛┗┛ ┻ 
Verify .get Paths  
 */
// Verify if /etc has 755 permissions if not try handlePermissionErrorForEnsureDir
const etcPath = '/etc';
const etcPermissions = await fs.promises.access(etcPath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
    .then(() => true)
    .catch(() => false);
    console.log(`Permissions for /etc: ${etcPermissions ? 'Read, Write, Execute' : 'No access'}`);
    console.log('Attempting to handle permission error for /etc directory');
if (!etcPermissions) {
    await handlePermissionErrorForEnsureDir(etcPath);
}

if(!xConfig.getPath){
const getDefaultPath = DEFAULT_DIRECTORIES.getPath;
    if (Path_Exists(getDefaultPath)) {
        await saveXConfig({ getPath: getDefaultPath });
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
        } else {
        console.log(`Default getPath does not exist: ${getDefaultPath}, not updating configuration.`);
    }
}

if(!xConfig.static){
const getDefaultStatic = DEFAULT_DIRECTORIES.static;
    if (Path_Exists(getDefaultStatic)) {
        await saveXConfig({ static: getDefaultStatic });
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    } else {
        console.log(`Default static does not exist: ${getDefaultStatic}, not updating configuration.`);
    }
}  


if(!xConfig.devPath){
const getDefaultDevPath = DEFAULT_DIRECTORIES.devPath;
    if (Path_Exists(getDefaultDevPath)) {
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
    if (Path_Exists(getDefaultDevStatic)) {
        await saveXConfig({ devStatic: getDefaultDevStatic });
        xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    } else {
        console.log(`Default devStatic does not exist: ${getDefaultDevStatic}, not updating configuration.`);
    }
}

/*
██   ██ ██████  ██       ██████   ██████ ██   ██ ███████ 
 ██ ██  ██   ██ ██      ██    ██ ██      ██  ██  ██      
  ███   ██████  ██      ██    ██ ██      █████   ███████ 
 ██ ██  ██   ██ ██      ██    ██ ██      ██  ██       ██ 
██   ██ ██████  ███████  ██████   ██████ ██   ██ ███████ 

 █████  ██    ██  █████  ██ ██       █████  ██████  ██      ███████ 
██   ██ ██    ██ ██   ██ ██ ██      ██   ██ ██   ██ ██      ██      
███████ ██    ██ ███████ ██ ██      ███████ ██████  ██      █████   
██   ██  ██  ██  ██   ██ ██ ██      ██   ██ ██   ██ ██      ██      
██   ██   ████   ██   ██ ██ ███████ ██   ██ ██████  ███████ ███████ */
// Check paths before attempting to create XBlocks-available directory
if (xConfig.nginxDir && Path_Exists(xConfig.nginxDir)) {
// Ensure 'XBlocks-available' directory exists or create it
const xBlocksAvailablePath = path.join(xConfig.nginxDir, 'XBlocks-available');
try { ensureDirectoryExists(xBlocksAvailablePath); } 
catch (error) {
    if (error.message.startsWith('PermissionError')) {
    // This is where you involve user decision
    await handlePermissionErrorForEnsureDir(xBlocksAvailablePath);
    } else {
    console.error(chalk.red(`Setup failed: ${error.message}`));
    }}
// Check if the directory was successfully created or already exists and update configuration if necessary
if (!xConfig.XBlocksAvailable && Path_Exists(xBlocksAvailablePath)) {
    await saveXConfig({ XBlocksAvailable: xBlocksAvailablePath });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    console.log(chalk.green("nginx/XBlocks-available path set successfully."));
    } else if (!Path_Exists(xBlocksAvailablePath)) {
    console.log(chalk.red("nginx/XBlocks-available path not set."));
    }
} else {
    console.log(chalk.yellow("Cannot proceed: NGINX directory path is not set or does not exist."));
}
/*
██   ██ ██████  ██       ██████   ██████ ██   ██ ███████ 
 ██ ██  ██   ██ ██      ██    ██ ██      ██  ██  ██      
  ███   ██████  ██      ██    ██ ██      █████   ███████ 
 ██ ██  ██   ██ ██      ██    ██ ██      ██  ██       ██ 
██   ██ ██████  ███████  ██████   ██████ ██   ██ ███████ 

███████ ███    ██  █████  ██████  ██      ███████ ██████  
██      ████   ██ ██   ██ ██   ██ ██      ██      ██   ██ 
█████   ██ ██  ██ ███████ ██████  ██      █████   ██   ██ 
██      ██  ██ ██ ██   ██ ██   ██ ██      ██      ██   ██ 
███████ ██   ████ ██   ██ ██████  ███████ ███████ ██████*/
// Check paths before attempting to create XBlocks-enabled directory
if (xConfig.nginxDir && Path_Exists(xConfig.nginxDir)) {
// Ensure 'XBlocks-enabled' directory exists or create it
const xBlocksEnabledPath = path.join(xConfig.nginxDir, 'XBlocks-enabled');
    try {  ensureDirectoryExists(xBlocksEnabledPath);  } 
    catch (error) {
    if (error.message.startsWith('PermissionError')) {
    // This is where you involve user decision
    await handlePermissionErrorForEnsureDir(xBlocksEnabledPath);
    } else { console.error(chalk.red(`Setup failed: ${error.message}`)); }}
// Check if the directory was successfully created or already exists and update configuration if necessary
if (!xConfig.XBlocksEnabled && Path_Exists(xBlocksEnabledPath)) {
    await saveXConfig({ XBlocksEnabled: xBlocksEnabledPath });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    console.log(chalk.green("nginx/XBlocks-enabled path set successfully."));
    } else if (!Path_Exists(xBlocksEnabledPath)) {
    console.log(chalk.red("nginx/XBlocks-enabled path not set."));
    }} else { console.log(chalk.yellow("Cannot proceed: NGINX directory path is not set or does not exist.")); }
   
/* nginx/dev_X
████████▄     ▄████████  ▄█    █▄           ▀████    ▐████▀ 
███   ▀███   ███    ███ ███    ███            ███▌   ████▀  
███    ███   ███    █▀  ███    ███             ███  ▐███    
███    ███  ▄███▄▄▄     ███    ███             ▀███▄███▀    
███    ███ ▀▀███▀▀▀     ███    ███              ████▀██▄     
███    ███   ███    █▄  ███    ███            ▐███  ▀███    
███   ▄███   ███    ███ ███    ███           ▄███     ███▄  
████████▀    ██████████  ▀██████▀ ████ ████ ████       ███▄*/
if (xConfig.nginxDir && Path_Exists(xConfig.nginxDir)) {
// Ensure 'dev_X' directory exists or create it
const dev_X = path.join(xConfig.nginxDir, 'dev_X');
try { ensureDirectoryExists(dev_X); } 
catch (error) {
    if (error.message.startsWith('PermissionError')) {
    await handlePermissionErrorForEnsureDir(dev_X);
    } else {
    console.error(chalk.red(`Setup failed: ${error.message}`));
    }}
// Check if the directory was successfully created or already exists and update configuration if necessary
if (!xConfig.nginxDevDir && Path_Exists(dev_X)) {
    await saveXConfig({ nginxDevDir: dev_X });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    console.log(chalk.green("nginx/dev_X path set successfully."));
    } else if (!Path_Exists(dev_X)) {
    console.log(chalk.yellow("nginx/dev_X path not set."));
    }} else { console.log(chalk.yellow("Cannot proceed: NGINX directory path is not set or does not exist.")); }
//DEV_X XBLOCKS-AVAILABLE 
// Check if the nginxDevDir is set and the path exists before attempting to create subdirectories
if (xConfig.nginxDevDir && Path_Exists(xConfig.nginxDevDir)) {
// Ensure DEV 'XBlocks-available' directory exists or create it
const dev_xBlocksAvailablePath = path.join(xConfig.nginxDevDir, 'XBlocks-available');
try { ensureDirectoryExists(dev_xBlocksAvailablePath); }
catch (error) {
    if (error.message.startsWith('PermissionError')) {
    // This is where you involve user decision
    await handlePermissionErrorForEnsureDir(dev_xBlocksAvailablePath);
    } else {
    console.error(chalk.red(`Setup failed: ${error.message}`)); }}
    // Check if the directory was successfully created or already exists and update configuration if necessary
    if (!xConfig.dev_XBlocksAvailable && Path_Exists(dev_xBlocksAvailablePath)) {
    await saveXConfig({ dev_XBlocksAvailable: dev_xBlocksAvailablePath });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    console.log(chalk.green("nginx/dev_X/XBlocks-available path set successfully."));
    } else if (!Path_Exists(dev_xBlocksAvailablePath)) {
    console.log(chalk.red("nginx/dev_X/XBlocks-available path not set."));
    }} else { console.log(chalk.yellow("Cannot proceed: NGINX DevDir path is not set or does not exist.")); }
//DEV_X XBLOCKS-ENABLED
//Check if the nginxDevDir is set and the path exists before attempting to create subdirectories
if (xConfig.nginxDevDir && Path_Exists(xConfig.nginxDevDir)) {
// Ensure DEV 'XBlocks-enabled' directory exists or create it
const dev_xBlocksEnabledPath = path.join(xConfig.nginxDevDir, 'XBlocks-enabled');
try { ensureDirectoryExists(dev_xBlocksEnabledPath); } catch (error) {
if (error.message.startsWith('PermissionError')) {
// This is where you involve user decision
await handlePermissionErrorForEnsureDir(dev_xBlocksEnabledPath);
} else { console.error(chalk.red(`Setup failed: ${error.message}`)); }}
// Check if the directory was successfully created or already exists and update configuration if necessary
if (!xConfig.dev_XBlocksEnabled && Path_Exists(dev_xBlocksEnabledPath)) {
    await saveXConfig({ dev_XBlocksEnabled: dev_xBlocksEnabledPath });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
    console.log(chalk.green("nginx/devX/XBlocks enabled path set successfully."));
    } else if (!Path_Exists(dev_xBlocksEnabledPath)) {
    console.log(chalk.red("nginx/devX/XBlocks enabled path not set."));
    }} else { console.log(chalk.yellow("Cannot proceed: NGINX DevDir path is not set or does not exist.")); }

/*
╔═╗╔═╗╦═╗╔╦╗╔═╗
╠═╝║ ║╠╦╝ ║ ╚═╗
╩  ╚═╝╩╚═ ╩ ╚═╝*/
if(!xConfig.xMainOutPutPort){
    await saveXConfig({ xMainOutPutPort: 3432 });
    xConfig = await loadOrCreateXConfig(); // Reload to ensure all config updates are reflected
}

/* Verify All Good. 
╔╗╔╔═╗╦╔╗╔═╗ ╦  ╔═╗╦ ╦╔═╗╔═╗╦╔═╔═╗
║║║║ ╦║║║║╔╩╦╝  ║  ╠═╣║╣ ║  ╠╩╗╚═╗
╝╚╝╚═╝╩╝╚╝╩ ╚═  ╚═╝╩ ╩╚═╝╚═╝╩ ╩╚═╝*/
let nginxVerified = await verifyNginxConfig(xConfig);
if (!nginxVerified) {
        console.log(chalk.yellow('Initial NGINX verification failed. Attempting to resolve...'));
        try {
            await nginxInstallationOptions();  // Attempt automated fixes
            nginxVerified = await verifyNginxConfig(xConfig);  // Re-check after attempting fixes
            if (!nginxVerified) {
                console.log(chalk.red('NGINX installation or configuration still incorrect after attempted fixes.'));
                console.log(chalk.blue('Please check the manual configuration guidelines or contact support.'));
                return false;
            } else {
                console.log(chalk.green('NGINX issues resolved successfully.'));
            }
        } catch (error) {
            console.log(chalk.red(`An error occurred while attempting to fix NGINX: ${error.message}`));
            console.log(chalk.blue('Please check the manual configuration guidelines or contact support.'));
            return false;
        }
    } 


/* Verify NGINX server block is correctly configured for netgetX.
    ╔═╗╔═╗╦═╗╦  ╦╔═╗╦═╗  ╔╗ ╦  ╔═╗╔═╗╦╔═
    ╚═╗║╣ ╠╦╝╚╗╔╝║╣ ╠╦╝  ╠╩╗║  ║ ║║  ╠╩╗
    ╚═╝╚═╝╩╚═ ╚╝ ╚═╝╩╚═  ╚═╝╩═╝╚═╝╚═╝╩ ╩*/
const serverBlockVerified = await verifyServerBlock(xConfig);
if (!serverBlockVerified) {
    console.log(chalk.yellow('Default Server block is not as NetGetX Default.'));
    return false;
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