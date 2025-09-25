import inquirer from 'inquirer';
import chalk from 'chalk';
import { NetGetSync } from './lib/netgetSync.js';
import fs from 'fs/promises';
import NetGetMainMenu from '../netget_MainMenu.cli.js';
import { getDomainsDbPath } from '../../utils/netgetPaths.js';

// Helper to load config
async function loadConfig(configPath) {
    try {
        const configFile = await fs.readFile(configPath || './deploy.config.json', 'utf8');
        return JSON.parse(configFile);
    } catch (error) {
        console.error(chalk.red(`Failed to load config: ${error.message}`));
        return null;
    }
}

// Helper to create NetGetSync instance
async function createSyncInstance(configPath) {
    const config = await loadConfig(configPath);
    if (!config) return null;
    return new NetGetSync({
        localDbPath: config.localDbPath,
        remoteServer: config.remoteServer,
        remoteApiKey: config.remoteApiKey,
        projectsBasePath: config.projectsBasePath
    });
}

export default async function netGetXDeployMenu() {
    console.clear();
    // ASCII art for "DEPLOY" (styled like NetGet art)
    console.log(`
    ██████ ╗██████╗ ███████╗██╗      ██████╗ ██╗ ██╗
    ██   ██║██╔═══╝ ██╔══██║██║     ██║   ██║██║ ██║
    ██   ██║█████╗  ██████╔╝██║     ██║   ██║╚████╔╝
    ██   ██║██╔══╝  ██╔═══╝ ██║     ██║   ██║ ╚██╔╝
    ██████╔╝███████╗██║     ╚██████ ╚██████╔╝  ██║
    ╚═════╝ ╚══════╝╚═╝      ╚═════╝ ╚═════╝   ╚═╝
 `);
    
    let exit = false;
    while (!exit) {
        const { option } = await inquirer.prompt({
            type: 'list',
            name: 'option',
            message: 'NetGet Deploy Menu:',
            choices: [
                '1. Initialize deployment config',
                '2. Compare local and remote',
                '3. Check remote server status',
                '4. Validate deployment config',
                '5. Sync local config to remote',
                '0. Back'
            ]
        });

        switch (option) {
            case '1. Initialize deployment config': {
                const { output } = await inquirer.prompt({ type: 'input', name: 'output', message: 'Output config file:', default: './deploy.config.json' });
                const config = {
                    localDbPath: getDomainsDbPath(),
                    remoteServer: 'https://your-remote-server.com',
                    remoteApiKey: 'your-api-key-here',
                    projectsBasePath: '/var/www',
                    timestamp: Date.now()
                };
                if (await fs.readFile(output).then(() => true).catch(() => false)) {
                    console.log(chalk.red(`File already exists: ${output}`));
                    break;
                }
                try {
                    await fs.writeFile(output, JSON.stringify(config, null, 2));
                    console.log(chalk.green(`Configuration file created: ${output}`));
                    console.log(chalk.yellow('\nPlease edit the configuration file with your settings:'));
                    console.log(`   - remoteServer: Your remote NetGet server URL`);
                    console.log(`   - remoteApiKey: Your API key for authentication`);
                    console.log(`   - localDbPath: Path to your local NetGet database`);
                    console.log(`   - projectsBasePath: Base path for your projects`);
                } catch (error) {
                    console.log(chalk.red(`Failed to create config: ${error.message}`));
                }
                break;
            }
            case '2. Compare local and remote': {
                const { config } = await inquirer.prompt({ type: 'input', name: 'config', message: 'Config file path:', default: './deploy.config.json' });
                const sync = await createSyncInstance(config);
                if (!sync) break;
                try {
                    await sync.compare();
                } catch (error) {
                    console.log(chalk.red(`Compare failed: ${error.message}`));
                }
                break;
            }
            case '3. Check remote server status': {
                const { config } = await inquirer.prompt({ type: 'input', name: 'config', message: 'Config file path:', default: './deploy.config.json' });
                console.log(chalk.blue(`Reading configuration from: ${config}`));
                const sync = await createSyncInstance(config);
                if (!sync) break;
                try {
                    const health = await sync.checkRemoteHealth();
                    // console.log(chalk.gray('--- Raw health response ---'));
                    // console.log(health);
                    console.log(chalk.green('Remote Server Status:'));
                    console.log(`   Status: ${health.status}`);
                    console.log(`   Database: ${health.database}`);
                    console.log(`   Openresty: ${health.openresty}`);
                    console.log(`   Timestamp: ${health.timestamp}`);
                } catch (error) {
                    console.log(chalk.red(`Check remote server status failed: ${error.message}`));
                }
            }
            case '4. Validate deployment config': {
                const { config } = await inquirer.prompt({ type: 'input', name: 'config', message: 'Config file path:', default: './deploy.config.json' });
                const loadedConfig = await loadConfig(config);
                if (!loadedConfig) break;
                console.log(chalk.blue('Validating configuration...\n'));
                const required = ['remoteServer', 'remoteApiKey', 'localDbPath'];
                const missing = required.filter(field => !loadedConfig[field]);
                if (missing.length > 0) {
                    console.log(chalk.red(`Missing required fields: ${missing.join(', ')}`));
                    break;
                }
                try {
                    await fs.access(loadedConfig.localDbPath);
                    console.log(chalk.green('Local database accessible'));
                    console.log(chalk.gray(`Path: ${loadedConfig.localDbPath}`));
                } catch {
                    console.log(chalk.red(`Local database not accessible: ${loadedConfig.localDbPath}`));
                    console.log(chalk.gray(`Path: ${loadedConfig.localDbPath}`));
                    break;
                }
                try {
                    const sync = await createSyncInstance(config);
                    await sync.checkRemoteHealth();
                    console.log(chalk.green('Remote server accessible'));
                    console.log(chalk.gray(`URL: ${loadedConfig.remoteServer}`));
                } catch (error) {
                    console.log(chalk.red(`Remote server not accessible: ${error.message}`));
                    console.log(chalk.gray(`URL: ${loadedConfig.remoteServer}`));
                    break;
                }
                console.log(chalk.green('\nConfiguration is valid!'));
                break;
            }
            case '5. Sync local config to remote': {
                const { config, includeProjects, domains } = await inquirer.prompt([
                    { type: 'input', name: 'config', message: 'Config file path:', default: './deploy.config.json' },
                    { type: 'confirm', name: 'includeProjects', message: 'Include project files in sync?', default: false },
                    { type: 'input', name: 'domains', message: 'Domains to sync (comma-separated, blank for all):', default: '' }
                ]);

                const sync = await createSyncInstance(config);
                if (!sync) break;
                try {
                    const syncOptions = {
                        includeProjects,
                        domains: domains ? domains.split(',').map(d => d.trim()) : null
                    };
                    const result = await sync.sync(syncOptions);
                    if (result.success) {
                        console.log(chalk.green(`\nSync completed: ${result.syncedDomains} domains processed`));
                    } else {
                        console.log(chalk.red(`\nSync failed: ${result.error}`));
                    }
                } catch (error) {
                    console.log(chalk.red(`Sync failed: ${error.message}`));
                }
                break;
            }
            case '0. Back':
                exit = true;
                await NetGetMainMenu();
            default:
                break;
        }
    }
}
