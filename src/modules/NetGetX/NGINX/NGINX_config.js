import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.get');
const USER_CONFIG_FILE = path.join(CONFIG_DIR, 'xConfig.json');

class NginxConfig {
    constructor() {
        this.config = {};
    }

    async loadConfig() {
        if (!fs.existsSync(USER_CONFIG_FILE)) {
            console.log(chalk.yellow('Default xConfig file does not exist. Creating...'));
            const defaultConfig = {
                nginxConfigurationProceed: false,
                nginxPath: "",
                nginxDir: "",
                nginxExecutable: "",
                mainServerName: "",
                xMainOutPutPort: 3432,
                domains: {},               
                publicIP: "",
                localIP: "",
                XBlocksAvailable: "",
                XBlocksEnabled: "",
                nginxDevDir: "",
                dev_XBlocksAvailable: "",
                dev_XBlocksEnabled: "",
                getPath: "",
                static: "",
                devPath: "",
                devStatic: "",
                useSudo: false,
            };
            fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(defaultConfig, null, 4));
            this.config = defaultConfig;
        } else {
            const data = await fs.promises.readFile(USER_CONFIG_FILE, 'utf8');
            this.config = JSON.parse(data);
        }
    }

    async saveConfig(updates) {
        if (!fs.existsSync(CONFIG_DIR)) {
            console.log(chalk.yellow(`Configuration directory does not exist at ${CONFIG_DIR}. Creating...`));
            fs.mkdirSync(CONFIG_DIR);
        }

        let config = this.config;
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
            delete updates.domain;
        } else {
            Object.assign(config, updates);
            updatesApplied = updates;
        }

        await fs.promises.writeFile(USER_CONFIG_FILE, JSON.stringify(config, null, 4));
        console.log(chalk.green('Configuration updated successfully.'));

        for (const [key, value] of Object.entries(updatesApplied)) {
            if (typeof value === 'object' && !Array.isArray(value)) {
                for (const [subKey, subValue] of Object.entries(value)) {
                    console.log(`xConfig.domains[${key}].${chalk.bgWhite.black.bold(subKey)}: ${chalk.yellow(subValue)} : ${chalk.bgGreen.bold("Success")}.`);
                }
            } else {
                console.log(`xConfig.${chalk.bgWhite.black.bold(key)}: ${chalk.yellow(value)} : ${chalk.bgGreen.bold("Success")}.`);
            }
        }
    }

    parseMainServerName(configFilePath) {
        try {
            const fileContent = fs.readFileSync(configFilePath, 'utf8');
            const match = fileContent.match(/server_name\s+([^;]+);/);
            return match ? match[1].trim() : 'default';
        } catch (error) {
            console.error(`Failed to read or parse the configuration file at ${configFilePath}:`, error.message);
            return 'default';
        }
    }

    changeServerName(newServerName) {
        this.config.mainServerName = newServerName;
        this.saveConfig(this.config);
    }

    getFormattedMainServerName() {
        const invalidServerNames = new Set(['default', '', '-', undefined, null]);
        const mainServerName = this.parseMainServerName(this.config.nginxPath);

        return invalidServerNames.has(mainServerName)
            ? 'default - No Server Name'
            : mainServerName;
    }

    displayServerConfig() {
        console.table({
            "Main Server Name": this.getFormattedMainServerName(),
            "XBlocks Available": this.config.XBlocksAvailable,
            "XBlocks Enabled": this.config.XBlocksEnabled,
            "OutPort": this.config.xMainOutPutPort,
            "Public IP": this.config.publicIP,
            "Local IP": this.config.localIP,
        });
    }
}

export default NginxConfig;
