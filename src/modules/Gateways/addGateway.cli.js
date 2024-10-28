// netget/src/modules/Gateways/addGateway.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { addGateway, loadOrCreateGConfig } from './config/gConfig.js';

/**
 * Prompts the user to add a new gateway and updates the configuration.
 * @category Gateways
 * @subcategory Main
 * @module addGateway
 */
async function addNewGateway() {
    // Load the existing configuration
    const config = await loadOrCreateGConfig();
    let name;
    let isNameUnique = false;

    while (!isNameUnique) {
        const { name: inputName } = await inquirer.prompt({
            type: 'input',
            name: 'name',
            message: 'Enter the name of the new gateway:',
        });

        // Check if the gateway name already exists
        if (config.gateways.some(gateway => gateway.name === inputName)) {
            console.log(chalk.red(`Gateway name "${inputName}" already exists. Please enter a different name.`));
        } else {
            name = inputName;
            isNameUnique = true;
        }
    }

    let port;
    let isPortValid = false;

    while (!isPortValid) {
        const { port: inputPort } = await inquirer.prompt({
            type: 'number',
            name: 'port',
            message: 'Enter the port for the new gateway:',
            validate: (input) => {
                if (Number.isNaN(input) || input <= 0 || input > 65535) {
                    return 'Please enter a valid port number (1-65535).';
                }
                return true;
            },
        });

        // Check if the port is already in use
        const existingGateway = config.gateways.find(gateway => gateway.port === inputPort);
        if (existingGateway) {
            console.log(chalk.yellow(`Port ${inputPort} is already used by gateway "${existingGateway.name}".`));
            const { keepPort } = await inquirer.prompt({
                type: 'confirm',
                name: 'keepPort',
                message: `Do you want to keep the port ${inputPort}? This may cause a conflict.`,
                default: false,
            });

            if (keepPort) {
                port = inputPort;
                isPortValid = true;
            }
        } else {
            port = inputPort;
            isPortValid = true;
        }
    }

    const { fallbackPort } = await inquirer.prompt({
        type: 'number',
        name: 'fallbackPort',
        message: 'Enter a fallback port for the new gateway (optional):',
        validate: (input) => {
            if (input === '' || (Number.isInteger(input) && input > 0 && input <= 65535)) {
                return true;
            }
            return 'Please enter a valid port number (1-65535) or leave it blank for no fallback port.';
        },
        filter: (input) => (input === ' ' ? null : input), // Convert empty string to null
    });

    const { script } = await inquirer.prompt({
        type: 'input',
        name: 'script',
        message: 'Enter the script path for the new gateway:',
        default: '',});

    const newGateway = {
        name,
        script,
        port,
        fallbackPort,
        status: 'stopped',
    };

    await addGateway(newGateway);
    console.log(chalk.green(`Gateway "${name}" added successfully on port ${port} with fallback port ${fallbackPort || 'none'}.`));

    // Reload the updated configuration
    const updatedConfig = await loadOrCreateGConfig();
    return updatedConfig;
}

export { addNewGateway };
