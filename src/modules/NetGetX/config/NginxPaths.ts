// netget/src/modules/NetGetX/config/NginxPaths.ts
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { saveXConfig, XConfig } from './xConfig.js';

// Interface for Nginx path configuration
interface NginxPathConfig {
    configPath: string | null;
    basePath: string | null;
}

/**
 * Finds the NGINX configuration file and its base directory on the system.
 * Adjusts the approach based on the operating system for better compatibility.
 * @memberof module:NetGetX.NginxConfiguration
 * @returns An object containing paths to the NGINX configuration file and its base directory or null values if not found.
 */
async function getNginxConfigAndDir(): Promise<NginxPathConfig> {
    const isWindows: boolean = os.platform() === 'win32';
    const configPaths: string[] = isWindows
        ? ['C:\\nginx\\nginx.conf']
        : ['/etc/nginx/nginx.conf', '/usr/local/etc/nginx/nginx.conf', '/opt/homebrew/etc/nginx/nginx.conf'];

    // Check if any standard path exists and return the path and its base directory
    const foundPath: string | undefined = configPaths.find(fs.existsSync);
    if (foundPath) {
        return {
            configPath: foundPath,
            basePath: path.dirname(foundPath)
        };
    }

    // Use appropriate system command to find the executable and config file
    try {
        const systemCommand: string = isWindows ? 'where' : 'which';
        const systemPath: string = execSync(`${systemCommand} nginx`).toString().trim();
        if (!systemPath) throw new Error('NGINX executable not found.');
        
        const configTestCmd: string = `${systemPath} -t`;
        const output: string = execSync(configTestCmd).toString();
        const match: RegExpMatchArray | null = output.match(/nginx: configuration file (\S*) syntax is ok/);
        if (match && match[1]) {
            return {
                configPath: match[1],
                basePath: path.dirname(match[1])
            };
        }
    } catch (error: any) {
        console.error(`Failed to locate NGINX via system PATH: ${error.message}`);
    }
    // Return null if no configuration path or base directory could be found
    return { configPath: null, basePath: null };
}

/**
 * Sets the NGINX configuration path in the user configuration.
 * @memberof module:NetGetX.NginxConfiguration
 * @param nginxConfigPath The NGINX configuration path to be set.
 * @param nginxBasePath The NGINX base path to be set.
 * @returns True if the path was set and saved successfully.
 */
async function setNginxConfigAndDir(nginxConfigPath: string, nginxBasePath: string): Promise<boolean> {
    try {
        await saveXConfig({ nginxPath: nginxConfigPath, nginxDir: nginxBasePath});
        return true;
    } catch (error: any) {
        console.error(`Failed to set NGINX configuration path: ${error.message}`);
        return false;
    }
}

/**
 * Attempts to set the NGINX executable path in the configuration based on the detected system paths or by querying the system environment.
 * Adjusts the method based on the operating system to enhance compatibility.
 * @memberof module:NetGetX.NginxConfiguration
 * @param xConfig - The configuration object that holds NGINX related settings.
 * @returns Returns true if the executable path is successfully set, otherwise false.
 */
async function setNginxExecutable(xConfig: XConfig): Promise<boolean> {
    if (!xConfig.nginxPath) {
        console.log("NGINX configuration path is not set. Please configure it first.");
        return false;  // Ensure NGINX path is set before attempting to set the executable
    }
    console.log("Checking for NGINX executable based on provided configuration path...");
    try {
        // Building a probable executable path based on common NGINX installation practices
        let probableExecutablePath: string = path.join(path.dirname(xConfig.nginxPath), '../../sbin/nginx');
        if (fs.existsSync(probableExecutablePath)) {
            xConfig.nginxExecutable = probableExecutablePath;
        } else {
            // Fallback to system-wide detection if the derived path doesn't exist
            probableExecutablePath = execSync('which nginx').toString().trim();
            if (probableExecutablePath && fs.existsSync(probableExecutablePath)) {
                xConfig.nginxExecutable = probableExecutablePath;
            } else {
                console.log('Failed to detect NGINX executable. Please ensure NGINX is installed.');
                return false;
            }
        }
        await saveXConfig({
            nginxExecutable: xConfig.nginxExecutable
        });
    //console.log(`NGINX executable path set to: ${xConfig.nginxExecutable}`);
     return true;     
    } catch (error: any) {
        console.error(`Error detecting NGINX executable: ${error.message}`);
        return false;
    }
}

export {
     getNginxConfigAndDir,
     setNginxConfigAndDir, 
     setNginxExecutable    
};

/*
Functionality: The functions address different aspects related to NGINX configuration management:
setNginxConfigAndDir: updates the configuration paths in the user's configuration,
    which is straightforward and effective.
getNginxConfigAndDir: attempts to locate the NGINX configuration file either from predefined paths
     or by extracting it from system commands, providing robustness in finding the configuration.
setNginxExecutable: attempts to set the NGINX executable path based on the NGINX path 
    from the configuration or system PATH, ensuring that the executable can be accurately referenced.
*/