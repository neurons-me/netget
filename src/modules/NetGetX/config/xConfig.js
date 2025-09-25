import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';

const CONFIG_DIR = getNetgetDataDir();
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'xConfig.json');

/**
 * Loads the user configuration file or creates it if it doesn't exist.
 * @memberof module:NetGetX.Config
 * @returns {Promise<Object>} The user configuration object.
 */
async function loadOrCreateXConfig() {
    try {
        if (!fs.existsSync(USER_CONFIG_FILE)) {
            console.log(chalk.yellow('Default xConfig file does not exist. Creating...'));
            const defaultConfig = {
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
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(chalk.red(`Failed to load or create user configuration: ${error.message}`));
        throw new Error('Failed to initialize user configuration.');
    }
}

/**
 * Updates the user configuration file with specific key-value pairs.
 * @memberof module:NetGetX.Config
 * @param {Object} updates - An object containing the key-value pairs to update.
 * @returns {Promise<void>}
 */
async function saveXConfig(updates) {
    try {
        // Ensure the configuration directory exists
        if (!fs.existsSync(CONFIG_DIR)) {
            console.log(chalk.yellow(`Configuration directory does not exist at ${CONFIG_DIR}. Creating...`));
            fs.mkdirSync(CONFIG_DIR);
        }

        let config = {};
        // Check if the configuration file exists and read the current configuration
        if (fs.existsSync(USER_CONFIG_FILE)) {
            const data = await fs.promises.readFile(USER_CONFIG_FILE, 'utf8');
            config = JSON.parse(data);
        }

        // Apply updates to the appropriate domain or root level
        let updatesApplied = {};
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
            if (typeof value === 'object' && !Array.isArray(value)) {
                for (const [subKey, subValue] of Object.entries(value)) {
                    console.log(`xConfig.domains[${key}].${chalk.bgWhite.black.bold(subKey)}: ${chalk.yellow(subValue)} : ${chalk.bgGreen.bold("Success")}.`);
                }
            } else {
                console.log(`xConfig.${chalk.bgWhite.black.bold(key)}: ${chalk.yellow(value)} : ${chalk.bgGreen.bold("Success")}.`);
            }
        }
    } catch (error) {
        console.error(chalk.red(`Failed to update user configuration: ${error.message}`));
        throw new Error('Failed to update user configuration.');
    }
}

export { loadOrCreateXConfig, saveXConfig };
