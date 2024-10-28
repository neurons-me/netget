// netget/src/modules/Gateways/config/gConfig.js
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getDirectoryPaths } from '../../utils/GETDirs.js';

const CONFIG_FILE = path.join(getDirectoryPaths().getPath, 'gConfig.json');
const defaultConfig = {
    gateways: [
        {
            name: 'netget-gateway',
            script: '',
            port: 3432,
            fallbackPort: 3433,
            status: 'stopped',
            count: 0
        
        }
    ]
};

/**
 * Loads the gateway configuration file or creates it if it does not exist.
 * @returns {object} The gateway configuration.
 * @category Gateways
 * @subcategory Config
 * @module gConfig
 */ 
async function loadOrCreateGConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            console.log(chalk.blue('Configuration file not found, creating default configuration.'));
            await saveGConfig(defaultConfig);
        }
        const configData = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(configData);
    } catch (error) {
        console.error(chalk.red('Failed to load or create gateway configuration:'), error);
        throw error;
    }
}

/**
 * Saves the gateway configuration to a file.
 * @param {object} config - The gateway configuration to save.
 * @category Gateways
 * @subcategory Config
 * @module gConfig
 */ 
async function saveGConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green('Gateway configuration saved successfully.'));
    } catch (error) {
        console.error(chalk.red('Failed to save gateway configuration:'), error);
        throw error;
    }
}

/**
 * Adds a new gateway to the configuration.
 * @param {object} newGateway - The new gateway to add.
 * @category Gateways
 * @subcategory Config
 * @module gConfig
 */
async function addGateway(newGateway) {
    try {
        const config = await loadOrCreateGConfig();
        config.gateways.push(newGateway);
        await saveGConfig(config);
    } catch (error) {
        console.error(chalk.red('Failed to add new gateway:'), error);
        throw error;
    }
}

/**
 * Deletes a gateway from the configuration.
 * @param {string} gatewayName - The name of the gateway to delete.
 * @category Gateways
 * @subcategory Config
 * @module gConfig
 */

async function deleteGateway(gatewayName) {
    const { confirmDelete } = await inquirer.prompt({
        type: 'confirm',
        name: 'confirmDelete',
        message: `Are you sure you want to delete ${gatewayName}?`,
        default: false,
    });

    if (!confirmDelete) {
        console.log(chalk.blue('Gateway deletion canceled.'));
        return;  // Exit the loop if the user cancels the deletion  
    }

    try {
        const config = await loadOrCreateGConfig();
        const index = config.gateways.findIndex(gateway => gateway.name === gatewayName);
        if (index === -1) {
            console.log(chalk.yellow(`Gateway "${gatewayName}" not found.`));
            return;
        }
        config.gateways.splice(index, 1);
        await saveGConfig(config);
    } catch (error) {
        console.error(chalk.red('Failed to delete gateway:'), error);
        throw error;
    }
}

export { loadOrCreateGConfig, saveGConfig, addGateway, deleteGateway };

