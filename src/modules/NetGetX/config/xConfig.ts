import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';


const CONFIG_DIR: string = getNetgetDataDir();
const USER_CONFIG_FILE: string = path.join(CONFIG_DIR, 'xConfig.json');

interface DomainConfig {
    [key: string]: any;
}

interface XConfig {
    osName?: string;
    mainServerName?: string;
    publicIP?: string;
    localIP?: string;
    getPath?: string;
    static?: string;
    devPath?: string;
    devStatic?: string;
    useSudo?: boolean;
    sslSelfSignedCertPath?: string;
    sslSelfSignedKeyPath?: string;
    sqliteDatabasePath?: string;
    xMainOutPutPort?: number;
    [key: string]: any; // Allow additional properties
}

interface ConfigUpdates extends Partial<XConfig> {
    domain?: string;
}

/**
 * Loads the user configuration file or creates it if it doesn't exist.
 * @memberof module:NetGetX.Config
 * @returns The user configuration object.
 */
async function loadOrCreateXConfig(): Promise<XConfig> {
    try {
        if (!fs.existsSync(USER_CONFIG_FILE)) {
            console.log(chalk.yellow('Default xConfig file does not exist. Creating...'));
            const defaultConfig: XConfig = {
                osName: "",
                mainServerName: "",             
                publicIP: "",
                localIP: "",
                getPath: "",
                static: "",
                devPath: "",
                devStatic: "",
                useSudo: false,
                sslSelfSignedCertPath: "",
                sslSelfSignedKeyPath: "",
                sqliteDatabasePath: "",
            };
            fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(defaultConfig, null, 4));
            return defaultConfig;
        } else {
            const data = await fs.promises.readFile(USER_CONFIG_FILE, 'utf8');
            return JSON.parse(data) as XConfig;
        }
    } catch (error: any) {
        console.error(chalk.red(`Failed to load or create user configuration: ${error.message}`));
        throw new Error('Failed to initialize user configuration.');
    }
}

/**
 * Updates the user configuration file with specific key-value pairs.
 * @memberof module:NetGetX.Config
 * @param updates - An object containing the key-value pairs to update.
 */
async function saveXConfig(updates: ConfigUpdates): Promise<void> {
    try {
        // Ensure the configuration directory exists
        if (!fs.existsSync(CONFIG_DIR)) {
            console.log(chalk.yellow(`Configuration directory does not exist at ${CONFIG_DIR}. Creating...`));
            fs.mkdirSync(CONFIG_DIR);
        }

        let config: XConfig = {};
        // Check if the configuration file exists and read the current configuration
        if (fs.existsSync(USER_CONFIG_FILE)) {
            const data = await fs.promises.readFile(USER_CONFIG_FILE, 'utf8');
            config = JSON.parse(data) as XConfig;
        }

        // Write the updated configuration back to the file
        await fs.promises.writeFile(USER_CONFIG_FILE, JSON.stringify(config, null, 4));
        console.log(chalk.green('Configuration updated successfully.'));
        
    } catch (error: any) {
        console.error(chalk.red(`Failed to update user configuration: ${error.message}`));
        throw new Error('Failed to update user configuration.');
    }
}

export { loadOrCreateXConfig, saveXConfig };
export type { XConfig, DomainConfig, ConfigUpdates };
