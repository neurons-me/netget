import fs from 'fs';
import chalk from 'chalk';
import { handlePermission } from '../../utils/handlePermissions.js';
import { loadOrCreateXConfig, saveXConfig } from '../config/xConfig.js';

/**
 * Parses the server_name directive from the main server configuration file.
 * @memberof module:NetGetX.Utils
 * @param {string} configFilePath - Path to the NGINX main server configuration file.
 * @returns {string} - The server_name value or 'default' if none found.
 */
const parseMainServerName = (configFilePath) => {
    try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        const match = fileContent.match(/server_name\s+([^;]+);/);
        return match ? match[1].trim() : 'default';
    } catch (error) {
        console.error(`Failed to read or parse the configuration file at ${configFilePath}:`, error.message);
        return 'default';
    }
};

/**
 * Changes the server_name directive in the main server configuration file.
 * @memberof module:NetGetX.Utils
 * @param {string} configFilePath - Path to the NGINX main server configuration file.
 * @param {string} newServerName - New server name to set.
 * @returns {Promise<boolean>} - True if the change was successful, false otherwise.
 * @throws {Error} - Throws an error if the file operation fails.
 */
const changeServerName = async (configFilePath, newServerName) => {
    try {
        // Load xConfig to update it
        let xConfig = await loadOrCreateXConfig();
        xConfig.mainServerName = newServerName;
        await saveXConfig(xConfig);  // Save the entire updated xConfig object

        //const fileContent = fs.readFileSync(configFilePath, 'utf8');
        //const updatedContent = fileContent.replace(/server_name\s+([^;]+);/, ` ${newServerName};`);
        //fs.writeFileSync(configFilePath, updatedContent);

        console.log(chalk.green(`Server name changed to: ${newServerName}`));
        return true;
    } catch (error) {
        if (error.code === 'EACCES') {
            const autoCommand = `sed -i 's/server_name .*/server_name ${newServerName};/' ${configFilePath}`;
            const manualInstructions = `Edit the file ${configFilePath} and replace the server_name directive with 'server_name ${newServerName};'`;
            await handlePermission('changing the server name', autoCommand, manualInstructions);
            return false;  // Indicate that permission handling was attempted
        } else {
            throw new Error(`Failed to change the server name in the configuration file at ${configFilePath}: ${error.message}`);
        }
    }
};

export { parseMainServerName, changeServerName };
