#!/usr/bin/env node

import { Command } from 'commander';
import { NetGetSync } from './lib/netgetSync.js';

import fs from 'fs/promises';

const program = new Command();

// Load configuration
async function loadConfig(configPath) {
  try {
    const configFile = await fs.readFile(configPath || './deploy.config.json', 'utf8');
    return JSON.parse(configFile);
  } catch (error) {
    console.error(`❌ Failed to load config: ${error.message}`);
    process.exit(1);
  }
}

// Initialize NetGetSync instance
async function createSyncInstance(configPath) {
  const config = await loadConfig(configPath);
  return new NetGetSync({
    localDbPath: config.localDbPath,
    remoteServer: config.remoteServer,
    remoteApiKey: config.remoteApiKey,
    projectsBasePath: config.projectsBasePath
  });
}

program
  .name('netget-deploy')
  .description('NetGet deployment and synchronization tool')
  .version('2.0.0');

// Sync command
program
  .command('sync')
  .description('Sync local NetGet configuration to remote server')
  .option('-c, --config <path>', 'Configuration file path', './deploy.config.json')
  .option('-p, --projects', 'Include project files in sync')
  .option('-d, --domains <domains>', 'Specific domains to sync (comma-separated)')
  .action(async (options) => {
    try {
      const sync = await createSyncInstance(options.config);
      
      const syncOptions = {
        includeProjects: options.projects,
        domains: options.domains ? options.domains.split(',').map(d => d.trim()) : null
      };

      const result = await sync.sync(syncOptions);
      
      if (result.success) {
        console.log(`\n✅ Sync completed: ${result.syncedDomains} domains processed`);
        process.exit(0);
      } else {
        console.error(`\n❌ Sync failed: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Compare command
program
  .command('compare')
  .description('Compare local and remote configurations')
  .option('-c, --config <path>', 'Configuration file path', './deploy.config.json')
  .action(async (options) => {
    try {
      const sync = await createSyncInstance(options.config);
      await sync.compare();
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Check remote server status')
  .option('-c, --config <path>', 'Configuration file path', './deploy.config.json')
  .action(async (options) => {
    try {
      // Print which config file is being used
      console.log(`🔍 Reading configuration from: ${options.config}`);
      const sync = await createSyncInstance(options.config);
      const health = await sync.checkRemoteHealth();
      console.log('--- Raw health response ---');
      console.log(health);
      console.log('� Remote Server Status:');
      console.log(`   Status: ${health.status}`);
      console.log(`   Database: ${health.database}`);
      console.log(`   Openresty: ${health.openresty}`);
      console.log(`   Timestamp: ${health.timestamp}`);
    } catch (error) {
      console.error(`❌ Remote server unreachable: ${error.message}`);
      process.exit(1);
    }
  });

// Init command
program
  .command('init')
  .description('Initialize deployment configuration')
  .option('-o, --output <path>', 'Output configuration file', './deploy.config.json')
  .action(async (options) => {
    try {
      const config = {
        localDbPath: "/opt/.get/domains.db",
        remoteServer: "https://your-remote-server.com",
        remoteApiKey: "your-api-key-here",
        projectsBasePath: "/var/www",
        timestamp: Date.now()
      };

      await fs.writeFile(options.output, JSON.stringify(config, null, 2));
      
      console.log(`✅ Configuration file created: ${options.output}`);
      console.log('\n📝 Please edit the configuration file with your settings:');
      console.log(`   - remoteServer: Your remote NetGet server URL`);
      console.log(`   - remoteApiKey: Your API key for authentication`);
      console.log(`   - localDbPath: Path to your local NetGet database`);
      console.log(`   - projectsBasePath: Base path for your projects`);
    } catch (error) {
      console.error(`❌ Failed to create config: ${error.message}`);
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate deployment configuration')
  .option('-c, --config <path>', 'Configuration file path', './deploy.config.json')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      
      console.log('🔍 Validating configuration...\n');
      
      // Check required fields
      const required = ['remoteServer', 'remoteApiKey', 'localDbPath'];
      const missing = required.filter(field => !config[field]);
      
      if (missing.length > 0) {
        console.error(`❌ Missing required fields: ${missing.join(', ')}`);
        process.exit(1);
      }
      
      // Check local database access
      try {
        await fs.access(config.localDbPath);
        console.log('✅ Local database accessible');
      } catch (error) {
        console.error(`❌ Local database not accessible: ${config.localDbPath}`);
        process.exit(1);
      }
      
      // Test remote server connectivity
      try {
        const sync = await createSyncInstance(options.config);
        await sync.checkRemoteHealth();
        console.log('✅ Remote server accessible');
      } catch (error) {
        console.error(`❌ Remote server not accessible: ${error.message}`);
        process.exit(1);
      }
      
      console.log('\n🎉 Configuration is valid!');
      
    } catch (error) {
      console.error(`❌ Validation failed: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
