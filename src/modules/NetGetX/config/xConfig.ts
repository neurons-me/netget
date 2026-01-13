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
    remoteApiKey?: string;
    mainServerIP?: string;
    mainServerCertPath?: string;
    mainServerKeyPath?: string;
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

async function loadXConfig(): Promise <XConfig> {
    try {
        if (fs.existsSync(USER_CONFIG_FILE)) {
            const data = await fs.promises.readFile(USER_CONFIG_FILE, 'utf8');
            return JSON.parse(data) as XConfig;
        } else {
            throw new Error('Configuration file does not exist.');
        }
    } catch (error: any) {
        console.error(chalk.red(`Failed to load user configuration: ${error.message}`));
        throw new Error('Failed to load user configuration.');
    }
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
                remoteApiKey: "",           
                publicIP: "",
                localIP: "",
                getPath: "",
                static: "",
                devPath: "",
                devStatic: "",
                useSudo: false,
                netgetXhtmlGatewayPath: "",
                htmlPath: "",
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

        // Base default config to ensure structure
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
            netgetXhtmlGatewayPath: "",
            htmlPath: "",
            sslSelfSignedCertPath: "",
            sslSelfSignedKeyPath: "",
            sqliteDatabasePath: "",
            xMainOutPutPort: undefined,
        };

        // Start from defaults, then merge existing file over them
        let config: XConfig = { ...defaultConfig };

        if (fs.existsSync(USER_CONFIG_FILE)) {
            const data = await fs.promises.readFile(USER_CONFIG_FILE, 'utf8');
            try {
            const existing = JSON.parse(data) as XConfig;
            config = { ...defaultConfig, ...existing };
            } catch {
            console.warn(chalk.yellow('Existing config is invalid JSON; using defaults.'));
            }
        } else {
            // Ensure file exists with defaults so structure is preserved
            await fs.promises.writeFile(USER_CONFIG_FILE, JSON.stringify(defaultConfig, null, 4), 'utf8');
        }

        // Apply updates but keep the default structure (ignore unknown keys)
        for (const [key, value] of Object.entries(updates)) {
            if (Object.prototype.hasOwnProperty.call(config, key)) {
            (config as any)[key] = value;
            } else {
            console.log(chalk.yellow(`Ignored unknown config key: ${key}`));
            }
        }

        // Write the updated configuration back to the file
        await fs.promises.writeFile(USER_CONFIG_FILE, JSON.stringify(config, null, 4), 'utf8');        
    } catch (error: any) {
        console.error(chalk.red(`Failed to update user configuration: ${error.message}`));
        throw new Error('Failed to update user configuration.');
    }
}

export { loadOrCreateXConfig, saveXConfig, loadXConfig };
export type { XConfig, DomainConfig, ConfigUpdates };
