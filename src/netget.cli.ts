#!/usr/bin/env node
import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { NetGetSync } from './modules/NetGet-Deploy/lib/netgetSync.ts';
import { mainMenu } from './utils/netgetServerOrLocal.cli.ts';

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const defaultDeployConfigPath = path.join(homeDir, '.this', 'me', 'deploy.config.json');

// Debugging hook: set NETGET_DEBUG=1 to print argv and early state
const DEBUG = !!process.env.NETGET_DEBUG;
if (DEBUG) {
  // eslint-disable-next-line no-console
  console.log('NETGET_DEBUG: process.argv=', process.argv);
}

async function loadDeployConfig(configPath?: string) {
  const cfgPath = configPath || defaultDeployConfigPath;
  try {
    const content = await fs.readFile(cfgPath, 'utf8');
    return JSON.parse(content);
  } catch (err: any) {
    console.error(chalk.red(`Failed to load deploy config at ${cfgPath}: ${err.message}`));
    return null;
  }
}

async function loadCredentials(credsPath?: string) {
  const p = credsPath || path.join(homeDir, '.this/me/pplalo', 'credentials.json');
  try {
    const content = await fs.readFile(p, 'utf8');
    return JSON.parse(content);
  } catch (err: any) {
    console.error(chalk.red(`Failed to load credentials from ${p}: ${err.message}`));
    return null;
  }
}

function validateCredentials(creds: any, username: string, password: string): boolean {
  if (!creds) return false;
  // Support different shapes: { username, password } OR { users: [{username,password}, ...] } OR { [username]: password }
  if (creds.username && creds.password) {
    return creds.username === username && creds.password === password;
  }
  if (Array.isArray(creds.users)) {
    return creds.users.some((u: any) => u.username === username && u.password === password);
  }
  if (typeof creds === 'object') {
    // map form
    if (creds[username] && typeof creds[username] === 'string') {
      return creds[username] === password;
    }
  }
  return false;
}

// Ensure the CLI prints the expected executable name in help/usage
program.name('netget');
program.usage('[options] [command]');

program
  .description('NetGet Command Line Interface') 
  .action(async () => {
    console.log('Initializing NetGet CLI...');
    // await i_DefaultNetGetX();
    await mainMenu();
  });

// Non-interactive deploy command
program
  .command('deploy <username> <secret>')
  .description('Non-interactive deploy. Example: npx netget deploy user pass --server https://remote --targets "[\"/path/to/project\"]" --config /path/to/deploy.config.json --creds /path/to/credentials.json')
  .option('--server <url>', 'Override remote server URL')
  .option('--targets <json>', 'JSON array string or comma-separated origin paths (ex: "[\"/opt/project/dist\"]" or "/opt/project/dist")')
  .option('--domain <domain>', 'Explicit domain name for the target (overrides parsing)')
  .option('--config <path>', 'Path to deploy.config.json')
  .option('--creds <path>', 'Path to credentials.json')
  .option('--include-projects', 'When using config-driven sync, include project files', false)
  .action(async (username: string, password: string, opts: any) => {
    try {
      const creds = await loadCredentials(opts.creds);
      if (!creds) {
        console.error(chalk.red('Credentials could not be loaded. Aborting.'));
        process.exit(1);
      }

      if (!validateCredentials(creds, username, password)) {
        console.error(chalk.red('Invalid username or password. Aborting.'));
        process.exit(1);
      }

      // Load deploy configuration only if explicitly provided; prefer --server when present
      let config: any = null;
      if (opts.config) {
        config = await loadDeployConfig(opts.config);
        if (!config) {
          console.error(chalk.red('Failed to load provided deploy config. Aborting.'));
          process.exit(1);
        }
      }

      if (!config && !opts.server) {
        console.error(chalk.red('No deploy config provided and no --server override supplied. Aborting.'));
        process.exit(1);
      }

      const effectiveConfig = {
        localDbPath: config?.localDbPath || `${homeDir}/domains.db`,
        remoteServer: opts.server || config?.remoteServer,
        remoteApiKey: config?.remoteApiKey,
        projectsBasePath: config?.projectsBasePath || '/var/www'
      };

      if (!effectiveConfig.remoteServer) {
        console.error(chalk.red('Remote server URL is not configured. Provide --server or set remoteServer in deploy config.'));
        process.exit(1);
      }

      const sync = new NetGetSync(effectiveConfig);

      // If targets option provided, treat as explicit origin paths to package and deploy
      if (opts.targets) {
        let targets: string[] = [];
        try {
          // Try parse as JSON
          const parsed = JSON.parse(opts.targets);
          if (Array.isArray(parsed)) targets = parsed;
        } catch {
          // Not JSON, split comma separated
          targets = opts.targets.split(',').map((s: string) => s.trim()).filter(Boolean);
        }

        if (targets.length === 0) {
          console.error(chalk.red('No valid targets parsed from --targets. Expecting JSON array or comma-separated paths.'));
          process.exit(1);
        }

        for (const origin of targets) {
          // Determine domain
          let domain = opts.domain;
          if (!domain) {
            // If origin looks like host/path (contains a dot before a slash), parse host as domain
            const m = origin.match(/^([^\/]+)\//);
            if (m && m[1] && m[1].includes('.')) {
              domain = m[1];
            }
          }

          if (!domain) {
            console.error(chalk.red(`Could not determine domain for origin '${origin}'. Provide --domain.`));
            continue;
          }

          // If origin contains a host prefix, strip it to obtain local path (/path/to/project)
          let localPath = origin;
          const slashIdx = origin.indexOf('/');
          if (slashIdx > 0 && origin.slice(0, slashIdx).includes('.')) {
            localPath = origin.slice(slashIdx);
          }

          // Package the project and deploy
          try {
            console.log(chalk.blue(`Packaging project at '${localPath}' for domain '${domain}'...`));
            const zipPath = await sync.packageProject(localPath, domain);
            console.log(chalk.blue(`Uploading ${zipPath} to ${effectiveConfig.remoteServer}...`));
            await sync.deployProject(domain, zipPath);
            // Cleanup zip
            try { await fs.unlink(zipPath); } catch {}
              console.log(chalk.green(`Deployed '${domain}' from '${localPath}' successfully.`));

              // Sync domain configuration to remote so remote knows about this domain/project
              try {
                const domainPayload = [{
                  domain: domain,
                  subdomain: '',
                  email: '',
                  sslMode: 'none',
                  sslCertificate: '',
                  sslCertificateKey: '',
                  target: localPath,
                  type: 'project',
                  projectPath: localPath,
                  owner: username
                }];

                console.log(chalk.blue(`Syncing domain configuration for '${domain}'...`));
                const syncResp = await sync.syncDomainConfig(domainPayload as any);
                console.log(chalk.green(`Domain '${domain}' synced: ${syncResp?.message || 'ok'}`));
              } catch (err: any) {
                console.error(chalk.red(`Failed to sync domain '${domain}': ${err.message}`));
              }
          } catch (err: any) {
            console.error(chalk.red(`Failed to deploy '${domain}' from '${localPath}': ${err.message}`));
          }
        }

        process.exit(0);
      }

      // If no explicit targets, run the config-driven sync
      if (opts.includeProjects) {
        console.log(chalk.blue('Running config-driven sync (including projects)...'));
        const result = await sync.sync({ includeProjects: true });
        if (result.success) {
          console.log(chalk.green('Sync completed successfully.'));
          process.exit(0);
        } else {
          console.error(chalk.red(`Sync failed: ${result.error || result.message}`));
          process.exit(1);
        }
      }

      console.log(chalk.yellow('No --targets provided and --include-projects not set. Nothing to do. Use --targets or --include-projects.'));
      process.exit(1);
    } catch (error: any) {
      console.error(chalk.red(`Deploy command failed: ${error.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);