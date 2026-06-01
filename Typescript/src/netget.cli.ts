#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync, realpathSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const defaultDeployConfigPath = path.join(homeDir, '.this', 'me', 'deploy.config.json');
const cliSourcePath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(cliSourcePath), '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const netgetSourcePath = resolveRealPath(packageRoot);
const netgetVersion = readPackageVersion();

// Debugging hook: set NETGET_DEBUG=1 to print argv and early state
const DEBUG = !!process.env.NETGET_DEBUG;
if (DEBUG) {
  // eslint-disable-next-line no-console
  console.log('NETGET_DEBUG: process.argv=', process.argv);
}

function resolveRealPath(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function isPromptExitError(err: any): boolean {
  return err?.name === 'ExitPromptError' || String(err?.message || '').includes('force closed the prompt');
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
program.version(netgetVersion);

program
  .description('NetGet Command Line Interface') 
  .action(async () => {
    console.log(`
▗▖  ▗▖▗▄▄▄▖▗▄▄▄▖▗▄▄▖▗▄▄▄▖▗▄▄▄▖
▐▛▚▖▐▌▐▌     █ ▐▌   ▐▌     █  
▐▌ ▝▜▌▐▛▀▀▘  █ ▐▌▝▜▌▐▛▀▀▘  █  
▐▌  ▐▌▐▙▄▄▖  █ ▝▚▄▞▘▐▙▄▄▖  █  
`);
    console.log(chalk.gray(`netget v${netgetVersion}`));
    console.log(chalk.gray(`src: ${netgetSourcePath}\n`));
    // await i_DefaultNetGetX();
    try {
      const { mainMenu } = await import('./utils/netgetServerOrLocal.cli.ts');
      await mainMenu();
    } catch (err: any) {
      if (isPromptExitError(err)) {
        console.log(chalk.gray('\nPrompt closed. Bye.'));
        process.exit(0);
      }
      console.error(chalk.red(`NetGet failed: ${err.message}`));
      if (DEBUG && err.stack) console.error(chalk.gray(err.stack));
      process.exit(1);
    }
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

      const { NetGetSync } = await import('./modules/NetGet-Deploy/lib/netgetSync.ts');
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

program
  .command('reload')
  .alias('restart')
  .description('Reload (or start) the OpenResty/NetGet gateway — equivalent to nginx -s reload without needing nginx in PATH')
  .action(async () => {
    try {
      const { startOpenRestyOnce } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
      const ok = await startOpenRestyOnce(true);
      if (ok) {
        console.log(chalk.green('NetGet gateway reloaded.'));
      } else {
        console.error(chalk.red('Reload failed. Check OpenResty logs.'));
        process.exit(1);
      }
    } catch (err: any) {
      console.error(chalk.red(`Reload failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('claim')
  .description('Claim this gateway — establish your .me identity as the owner (first-run setup or key update)')
  .option('--reset', 'Force re-claim even if gateway is already claimed (updates Ed25519 key)')
  .action(async (opts: { reset?: boolean }) => {
    try {
      const { GatewayClaimsManager, getGatewayClaimsPath } = await import('./modules/NetGetX/Auth/GatewayClaimsManager.ts');
      const mgr = new GatewayClaimsManager();

      if (!mgr.needsBootstrap() && !opts.reset) {
        // Already bootstrapped — show current state.
        const claims = mgr.read()!;
        console.log(chalk.green('\n  ✔ Gateway is already anchored.\n'));
        console.log(`  Owner hash:   ${chalk.yellow(claims.owner)}`);
        const pubkey = claims.owner ? claims.pubkeys?.[claims.owner] : null;
        console.log(`  Ed25519 key:  ${chalk.yellow(pubkey ?? '(none — hash-only auth)')}`);
        console.log(`  Auth mode:    ${chalk.green(pubkey ? 'Ed25519 challenge-response ✓' : 'hash comparison (legacy)')}`);
        console.log(`  Claims file:  ${chalk.gray(getGatewayClaimsPath())}`);
        console.log(chalk.gray('\n  Run with --reset to re-claim and update the Ed25519 key.\n'));
        process.exit(0);
      }

      if (opts.reset && !mgr.needsBootstrap()) {
        // Remove the claims file so bootstrapOwner() treats this as a fresh gateway.
        const { unlinkSync } = await import('fs');
        try { unlinkSync(getGatewayClaimsPath()); } catch { /* already gone */ }
        console.log(chalk.yellow('  Previous claim cleared. Re-claiming…\n'));
      }

      const { runBootstrapWizard } = await import('./modules/NetGetX/Auth/bootstrapWizard.cli.ts');
      const hash = await runBootstrapWizard();
      process.exit(hash ? 0 : 1);
    } catch (err: any) {
      console.error(chalk.red(`\nClaim failed: ${err.message}`));
      if (DEBUG && err.stack) console.error(chalk.gray(err.stack));
      process.exit(1);
    }
  });

program
  .command('init')
  .alias('initialize')
  .description('Initialize Gateway — generate certs, write config, and start the gateway service')
  .action(async () => {
    try {
      const chalk = (await import('chalk')).default;
      const { loadOrCreateXConfig } = await import('./modules/NetGetX/config/xConfig.ts');
      const { ensureMkcertCert } = await import('./modules/NetGetX/Domains/SSL/mkcert/mkcert.ts');
      const includeNetgetAppConf = (await import('./modules/NetGetX/OpenResty/includeNetgetAppConf.ts')).default;
      const { installOpenRestyService, waitForOpenRestyGateway, getOpenRestyServiceStatus } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
      const { GatewayClaimsManager } = await import('./modules/NetGetX/Auth/GatewayClaimsManager.ts');

      console.log(chalk.cyan('\n⚡ netget init\n'));
      await loadOrCreateXConfig();

      // ── Step 1: Gateway ──────────────────────────────────────────────────────
      const service = await getOpenRestyServiceStatus();
      const isOnline = service.httpListening || service.httpsListening;

      if (!isOnline) {
        process.stdout.write(chalk.cyan('[1/3] Generating HTTPS cert… '));
        const certResult = ensureMkcertCert();
        console.log(certResult.ok ? chalk.green('✔') : chalk.yellow(`skipped (${certResult.message})`));

        process.stdout.write(chalk.cyan('[2/3] Writing gateway config… '));
        await includeNetgetAppConf();
        console.log(chalk.green('✔'));

        process.stdout.write(chalk.cyan('[3/3] Starting gateway… '));
        const installed = await installOpenRestyService();
        if (!installed) {
          console.log(chalk.red('✗'));
          console.error(chalk.red('Failed to start gateway. Try: sudo openresty'));
          process.exit(1);
        }
        const next = await waitForOpenRestyGateway();
        console.log((next.httpListening || next.httpsListening)
          ? chalk.green('✔ listening on 80/443.')
          : chalk.yellow('⚠  not yet listening.'));
      } else {
        console.log(chalk.green('✔ Gateway already running.'));
      }

      // ── Step 2: Claim ────────────────────────────────────────────────────────
      const mgr = new GatewayClaimsManager();
      if (mgr.needsBootstrap()) {
        console.log(chalk.cyan('\n── Establish gateway identity ──'));
        console.log(chalk.gray('Your credentials are never stored — only the resulting hash.\n'));
        const { runBootstrapWizard } = await import('./modules/NetGetX/Auth/bootstrapWizard.cli.ts');
        const ownerHash = await runBootstrapWizard();
        if (!ownerHash) {
          console.log(chalk.yellow('\nClaim skipped. Run netget init again to claim later.'));
          return;
        }
        console.log(chalk.green('\n✔ Gateway claimed.'));
      } else {
        console.log(chalk.green('✔ Gateway already claimed.'));
      }

      // ── Step 3: Monad ────────────────────────────────────────────────────────
      console.log(chalk.cyan('\n── Start monad ──'));
      console.log(chalk.gray('Run the following to register a monad with this gateway:\n'));
      console.log(chalk.white('  cd <your-monad-directory>'));
      console.log(chalk.white('  netget monad start local\n'));
      console.log(chalk.green('✔ Init complete. Refresh your browser.\n'));

    } catch (err: any) {
      const chalk = (await import('chalk')).default;
      console.error(chalk.red(`Init failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('generate-domain-map')
  .description('Project current domain config into ~/.get/runtime/domain-map.json for OpenResty')
  .action(async () => {
    try {
      const { ensureLocalNetgetSeed, generateDomainMap } = await import('./runtime/domainMap.ts');
      await ensureLocalNetgetSeed();
      const mapPath = await generateDomainMap();
      const map = JSON.parse(readFileSync(mapPath, 'utf8'));
      const domainList = Object.keys(map.domains);
      console.log(chalk.green(`Written: ${mapPath}`));
      console.log(`Domains (${domainList.length}): ${domainList.join(', ') || '(none)'}`);
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: any) => {
  if (isPromptExitError(err)) {
    console.log(chalk.gray('\nPrompt closed. Bye.'));
    process.exit(0);
  }
  console.error(chalk.red(`NetGet failed: ${err.message}`));
  if (DEBUG && err.stack) console.error(chalk.gray(err.stack));
  process.exit(1);
});
