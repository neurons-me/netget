import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

const CONFIG_DIR: string = path.join('/opt/','.get');
const USER_CONFIG_FILE: string = path.join(CONFIG_DIR, 'xConfig.json');

interface DomainConfig {
    [key: string]: any;
}

interface XConfig {
    mainServerName?: string;
    domains?: { [domain: string]: DomainConfig };
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
                mainServerName: "",
                domains: {},               
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

        // Apply updates to the appropriate domain or root level
        let updatesApplied: { [key: string]: any } = {};
        if (updates.domain) {
            if (!config.domains) {
                config.domains = {};
            }
            const domain = updates.domain;
            if (!config.domains[domain]) {
                config.domains[domain] = {};
            }
            Object.assign(config.domains[domain], updates);
            updatesApplied[domain] = updates;
            delete updates.domain;  // Remove domain from updates to prevent root-level updates
        } else {
            Object.assign(config, updates);
            updatesApplied = updates;
        }

        // Write the updated configuration back to the file
        await fs.promises.writeFile(USER_CONFIG_FILE, JSON.stringify(config, null, 4));
        console.log(chalk.green('Configuration updated successfully.'));
        
        // Log only the updated values
        for (const [key, value] of Object.entries(updatesApplied)) {
            if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
                for (const [subKey, subValue] of Object.entries(value)) {
                    console.log(`xConfig.domains[${key}].${chalk.bgWhite.black.bold(subKey)}: ${chalk.yellow(subValue)} : ${chalk.bgGreen.bold("Success")}.`);
                }
            } else {
                console.log(`xConfig.${chalk.bgWhite.black.bold(key)}: ${chalk.yellow(value)} : ${chalk.bgGreen.bold("Success")}.`);
            }
        }
    } catch (error: any) {
        console.error(chalk.red(`Failed to update user configuration: ${error.message}`));
        throw new Error('Failed to update user configuration.');
    }
}

export { loadOrCreateXConfig, saveXConfig };
export type { XConfig, DomainConfig, ConfigUpdates };