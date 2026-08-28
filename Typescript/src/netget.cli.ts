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
  .option('--json', 'Print a single JSON line instead of colored text (for scripted/HTTP callers)')
  .action(async (opts: { json?: boolean }) => {
    try {
      const { startOpenRestyOnce } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
      const ok = await startOpenRestyOnce(true);
      if (opts.json) {
        console.log(JSON.stringify({ ok, message: ok ? 'NetGet gateway reloaded.' : 'Reload failed. Check OpenResty logs.' }));
        process.exit(ok ? 0 : 1);
      }
      if (ok) {
        console.log(chalk.green('NetGet gateway reloaded.'));
      } else {
        console.error(chalk.red('Reload failed. Check OpenResty logs.'));
        process.exit(1);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, message }));
        process.exit(1);
      }
      console.error(chalk.red(`Reload failed: ${message}`));
      process.exit(1);
    }
  });

// Read-only status — no sudo required (port checks + launchctl/systemctl
// `is-active`/`print`, both read-only). Safe to call from an unattended HTTP
// caller, unlike stop/start/reload which shell out through sudo below.
program
  .command('status')
  .description('Report OpenResty/NetGet gateway status as one JSON line: { platform, bin, mode, serviceActive, httpListening, httpsListening, detail }')
  .action(async () => {
    try {
      const { getOpenRestyServiceStatus } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
      const status = await getOpenRestyServiceStatus();
      console.log(JSON.stringify({ ok: true, ...status }));
      process.exit(0);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

// Stops the gateway and removes the launchd/systemd service, same as the
// interactive "NetGet OFF" option in openRestyInstallationOptions.cli.ts.
// Shells out through sudo (stopOpenRestyGateway -> runSudoShell) — requires
// either an interactive terminal or a passwordless sudo rule for this
// command when called from a non-interactive caller (e.g. the HTTP endpoint).
program
  .command('stop')
  .description('Stop the OpenResty/NetGet gateway and remove its service. Prints one JSON line: { ok, message }.')
  .action(async () => {
    try {
      const { stopOpenRestyGateway } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
      const ok = await stopOpenRestyGateway();
      console.log(JSON.stringify({ ok, message: ok ? 'NetGet gateway stopped.' : 'Stop failed. Check OpenResty logs.' }));
      process.exit(ok ? 0 : 1);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

// Lifecycle for the GUI package's Vite dev server ("dev" main-server-frontend
// mode proxies the local panel to this). Read-only, safe to poll.
program
  .command('dev-server-status')
  .description('Report the local GUI dev server status as one JSON line: { ok, running, pid, url, message }.')
  .action(async () => {
    try {
      const { getDevServerStatus } = await import('./modules/NetGetX/OpenResty/devServer.ts');
      console.log(JSON.stringify(await getDevServerStatus()));
      process.exit(0);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('dev-server-start')
  .description('Start the local GUI dev server (npm run dev) if not already running. Prints one JSON line: { ok, running, pid, url, message }.')
  .action(async () => {
    try {
      const { startDevServer } = await import('./modules/NetGetX/OpenResty/devServer.ts');
      const result = await startDevServer();
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('dev-server-stop')
  .description('Stop the local GUI dev server. Prints one JSON line: { ok, message }.')
  .action(async () => {
    try {
      const { stopDevServer } = await import('./modules/NetGetX/OpenResty/devServer.ts');
      const result = await stopDevServer();
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

// Lifecycle for local.netget's own Express backend (proxy.js) — replaces
// PM2 (ecosystem.config.cjs) with the same PID-file pattern already used for
// the GUI dev server above. Read-only status is safe to poll.
program
  .command('backend-status')
  .description('Report the local.netget backend status as one JSON line: { ok, running, pid, port, url, message }.')
  .action(async () => {
    try {
      const { getBackendStatus } = await import('./htmls/Netget-REACT/backend/backendProcess.ts');
      console.log(JSON.stringify(await getBackendStatus()));
      process.exit(0);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('backend-start')
  .description('Start the local.netget backend (proxy.js) if not already running. Pass --production for production env. Prints one JSON line.')
  .option('--production', 'Start with NODE_ENV=production, USE_HTTPS=true')
  .action(async (opts: { production?: boolean }) => {
    try {
      const { startBackend } = await import('./htmls/Netget-REACT/backend/backendProcess.ts');
      const result = await startBackend({ production: Boolean(opts.production) });
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('backend-stop')
  .description('Stop the local.netget backend. Prints one JSON line: { ok, message }.')
  .action(async () => {
    try {
      const { stopBackend } = await import('./htmls/Netget-REACT/backend/backendProcess.ts');
      const result = await stopBackend();
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

// Non-interactive cert provisioning — the piece the interactive Domains menu
// (domainsOptions.ts addNewDomain) previously had exclusively. Exists so the
// /provision-cert HTTP endpoint (lua/handlers/domains.lua) can trigger real
// Let's Encrypt issuance without SSH, by shelling out to this subcommand.
// Output is a single JSON line so callers (Lua, scripts) can parse it directly.
program
  .command('provision-cert <domain>')
  .description('Provision (or renew) a Let\'s Encrypt cert for a registered public domain via certbot webroot. Prints one JSON line: { ok, message, certPath?, keyPath? }.')
  .requiredOption('--email <email>', 'Contact email for the Let\'s Encrypt account')
  .action(async (domain: string, opts: { email: string }) => {
    try {
      const { provisionCert } = await import('./modules/NetGetX/Domains/SSL/Certbot/certbotProvision.ts');
      const result = await provisionCert(domain, opts.email);
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: any) {
      console.log(JSON.stringify({ ok: false, message: err instanceof Error ? err.message : String(err) }));
      process.exit(1);
    }
  });

program
  .command('sync-certs')
  .description('Re-link every registered domain\'s cert/key paths from /etc/letsencrypt/live, fix gateway-worker read ACLs, and hot-reload nginx if anything changed. Called by the certbot renewal deploy hook (certbotProvision.ts) after every successful renewal — must exist as a real command, since the hook shells out to it non-interactively.')
  .action(async () => {
    try {
      const { syncCertsFromLetsEncrypt } = await import('./modules/NetGetX/Domains/SSL/Certbot/certbotProvision.ts');
      await syncCertsFromLetsEncrypt();
      process.exit(0);
    } catch (err: any) {
      console.error(chalk.red(`sync-certs failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

program
  .command('migrate-legacy-domains')
  .description('One-time migration: copy every row from the legacy sqlite domains table into the kernel-backed domain store, then regenerate the domain-map. Safe to re-run (upserts).')
  .option('--sqlite-path <path>', 'Path to the legacy domains.db', `${process.env.NETGET_DATA_DIR || (process.platform === 'linux' ? '/opt/.get' : '')}/domains.db`)
  .action(async (opts: { sqlitePath: string }) => {
    try {
      const { migrateLegacyDomains } = await import('./modules/NetGetX/Domains/migrateLegacyDomains.ts');
      const result = await migrateLegacyDomains(opts.sqlitePath);
      console.log(result.ok ? chalk.green(result.message) : chalk.yellow(result.message));
      process.exit(result.ok ? 0 : 1);
    } catch (err: any) {
      console.error(chalk.red(`migrate-legacy-domains failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

program
  .command('frontend-mode [mode]')
  .description('Switch the Main Server panel between dev (live Vite proxy), local-dist (~/.get/dist), and package-dist (bundled with the npm package) — no SSH-and-hand-edit required. Omit mode to print the current one.')
  .option('--json', 'Print a single JSON line instead of colored text (for scripted/HTTP callers)')
  .action(async (mode: string | undefined, opts: { json?: boolean }) => {
    try {
      const {
        resolveMainServerFrontendConfig,
        saveMainServerFrontendConfig,
        syncMainServerFrontendToHtmlRoot,
        copyPackageMainServerUiToLocalDist,
      } = await import('./modules/NetGetX/OpenResty/mainServerFrontend.ts');

      if (!mode) {
        const current = resolveMainServerFrontendConfig();
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, mode: current.mode, devUrl: current.devUrl, localDistRoot: current.localDistRoot, packageDistRoot: current.packageDistRoot }));
          return;
        }
        console.log(chalk.cyan(`Current mode: ${current.mode}`));
        console.log(chalk.gray(`  dev url:      ${current.devUrl}`));
        console.log(chalk.gray(`  local dist:   ${current.localDistRoot}`));
        console.log(chalk.gray(`  package dist: ${current.packageDistRoot}`));
        return;
      }

      if (mode !== 'dev' && mode !== 'package-dist' && mode !== 'local-dist') {
        const message = `Invalid mode: ${mode}. Use dev, package-dist, or local-dist.`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, message }));
          process.exit(1);
        }
        console.error(chalk.red(message));
        process.exit(1);
      }

      await saveMainServerFrontendConfig({ mode });

      // local-dist serves ~/.get/dist — a per-machine copy of the package
      // build, not the package build itself. Switching modes never used to
      // refresh that copy: copyPackageMainServerUiToLocalDist() existed but
      // was only ever wired into the interactive menu's separate
      // "copy-bundled" action, never called from here. Without this,
      // switching to local-dist silently served whatever was last manually
      // copied — possibly a build from days earlier — with no indication
      // anything was stale.
      let localDistCopy: { copied: boolean; from: string; to: string } | null = null;
      if (mode === 'local-dist') {
        localDistCopy = copyPackageMainServerUiToLocalDist();
      }

      const { getNetgetAppConfContent } = await import('./modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
      const { writeFileWithFallback } = await import('./modules/NetGetX/OpenResty/includeNetgetAppConf.ts');
      const { detectOpenRestyLayout } = await import('./modules/NetGetX/OpenResty/platformDetect.ts');
      const { startOpenRestyOnce } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');

      const layout = detectOpenRestyLayout();
      if (!layout.isSupported) {
        const message = `Mode set to ${mode}, but this platform has no OpenResty layout to reload — regenerate config manually.`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, mode, reloaded: false, message }));
          return;
        }
        console.log(chalk.yellow(message));
        return;
      }

      const path = (await import('path')).default;
      const destConf = path.join(layout.confDDir, 'netget_app.conf');
      await writeFileWithFallback(destConf, getNetgetAppConfContent(), `write netget_app.conf at ${destConf}`);

      const syncResult = syncMainServerFrontendToHtmlRoot();
      const reloaded = await startOpenRestyOnce(true);

      if (opts.json) {
        console.log(JSON.stringify({
          ok: true,
          mode,
          reloaded,
          htmlRootSynced: !!syncResult.copied,
          localDistCopied: !!localDistCopy?.copied,
          message: reloaded ? `Frontend mode set to ${mode}.` : `Frontend mode set to ${mode}, but reload may have failed — check OpenResty logs.`,
        }));
        return;
      }

      console.log(chalk.green(`✔ Frontend mode set to ${mode}.`));
      if (localDistCopy?.copied) console.log(chalk.gray(`  ~/.get/dist refreshed from ${localDistCopy.from}`));
      if (syncResult.copied) console.log(chalk.gray(`  html root synced from ${syncResult.from}`));
      console.log(reloaded ? chalk.green('✔ Gateway reloaded.') : chalk.yellow('⚠ Reload may have failed — check OpenResty logs.'));
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, message }));
        process.exit(1);
      }
      console.error(chalk.red(`frontend-mode failed: ${message}`));
      process.exit(1);
    }
  });

program
  .command('app-frontend-mode <name> [mode]')
  .description('Switch a registered app between dev (live proxy through /apps/<name>) and dist (its own built dist/ served directly) — the same toggle frontend-mode gives netget\'s own panel, generalized to any app.')
  .option('--json', 'Print a single JSON line instead of colored text (for scripted/HTTP callers)')
  .action(async (name: string, mode: string | undefined, opts: { json?: boolean }) => {
    try {
      // apps.json has exactly one writer today — apps.lua's atomic
      // tmp+rename, racing the app's own ~3s heartbeat. Routing this
      // through the running gateway (instead of the CLI read-modify-writing
      // apps.json directly) keeps that true; it does mean OpenResty must
      // already be running, which is fine — toggling a live app's routing
      // is inherently a live-gateway operation.
      const base = process.env.NETGET_LOCAL || 'http://127.0.0.1';

      if (!mode) {
        const res = await fetch(`${base}/apps/${encodeURIComponent(name)}/__frontend-mode`);
        const data = await res.json().catch(() => null);
        if (opts.json) {
          console.log(JSON.stringify(data ?? { success: false, error: `HTTP ${res.status}` }));
          return;
        }
        if (!res.ok || !data?.success) {
          console.error(chalk.red(data?.error || `Could not read frontend mode for '${name}' (HTTP ${res.status}).`));
          process.exit(1);
        }
        console.log(chalk.cyan(`Current mode: ${data.frontendMode}`));
        console.log(chalk.gray(`  dist dir: ${data.distDir || '(not reported)'}`));
        return;
      }

      if (mode !== 'dev' && mode !== 'dist') {
        const message = `Invalid mode: ${mode}. Use dev or dist.`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, message }));
          process.exit(1);
        }
        console.error(chalk.red(message));
        process.exit(1);
      }

      const setRes = await fetch(`${base}/apps/${encodeURIComponent(name)}/__frontend-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const setData = await setRes.json().catch(() => null);
      if (!setRes.ok || !setData?.success) {
        const message = setData?.error || `Could not set frontend mode (HTTP ${setRes.status}).`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, message }));
          process.exit(1);
        }
        console.error(chalk.red(message));
        process.exit(1);
      }

      const { getNetgetAppConfContent } = await import('./modules/NetGetX/OpenResty/setNginxConfigRoutes.ts');
      const { writeFileWithFallback } = await import('./modules/NetGetX/OpenResty/includeNetgetAppConf.ts');
      const { detectOpenRestyLayout } = await import('./modules/NetGetX/OpenResty/platformDetect.ts');
      const { startOpenRestyOnce } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');

      const layout = detectOpenRestyLayout();
      if (!layout.isSupported) {
        const message = `Mode set to ${mode}, but this platform has no OpenResty layout to reload — regenerate config manually.`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, name, mode, reloaded: false, message }));
          return;
        }
        console.log(chalk.yellow(message));
        return;
      }

      const nodePath = (await import('path')).default;
      const destConf = nodePath.join(layout.confDDir, 'netget_app.conf');
      await writeFileWithFallback(destConf, getNetgetAppConfContent(), `write netget_app.conf at ${destConf}`);
      const reloaded = await startOpenRestyOnce(true);

      if (opts.json) {
        console.log(JSON.stringify({
          ok: true,
          name,
          mode,
          reloaded,
          message: reloaded ? `Frontend mode for '${name}' set to ${mode}.` : `Frontend mode set to ${mode}, but reload may have failed — check OpenResty logs.`,
        }));
        return;
      }

      console.log(chalk.green(`✔ Frontend mode for '${name}' set to ${mode}.`));
      console.log(reloaded ? chalk.green('✔ Gateway reloaded.') : chalk.yellow('⚠ Reload may have failed — check OpenResty logs.'));
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, message }));
        process.exit(1);
      }
      console.error(chalk.red(`app-frontend-mode failed: ${message}`));
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
        await mgr.reset();
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
      const { syncNginxConfigFile } = await import('./modules/NetGetX/OpenResty/setNginxConfigFile.ts');
      const { installOpenRestyService, waitForOpenRestyGateway, getOpenRestyServiceStatus } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
      const { GatewayClaimsManager } = await import('./modules/NetGetX/Auth/GatewayClaimsManager.ts');

      console.log(chalk.cyan('\n⚡ netget init\n'));
      await loadOrCreateXConfig();

      // ── Step 1: Gateway ──────────────────────────────────────────────────────
      const service = await getOpenRestyServiceStatus();
      const isOnline = service.httpListening || service.httpsListening;

      // Always refresh cert + config so git pull changes take effect.
      process.stdout.write(chalk.cyan('[1/3] HTTPS cert… '));
      const certResult = ensureMkcertCert();
      console.log(certResult.ok ? chalk.green('✔') : chalk.yellow(`skipped (${certResult.message})`));

      process.stdout.write(chalk.cyan('[2/3] Gateway config… '));
      await includeNetgetAppConf();
      // nginx.conf itself (the MAIN_SERVER_NAME bypass, the SSL default_server
      // and wildcard-cert-fallback fixes) has no other regeneration path —
      // buildNginxConfigContent() previously had zero real callers, so a
      // fixed template only ever reached a live server via a hand-patched
      // SSH session. init now keeps it in sync the same way it already does
      // for netget_app.conf.
      const nginxConfChanged = await syncNginxConfigFile();
      console.log(chalk.green('✔') + (nginxConfChanged ? chalk.gray(' (nginx.conf updated)') : ''));

      if (!isOnline) {
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
        process.stdout.write(chalk.cyan('[3/3] Reloading gateway… '));
        const { startOpenRestyOnce } = await import('./modules/NetGetX/OpenResty/openRestyService.ts');
        await startOpenRestyOnce(true);
        console.log(chalk.green('✔'));
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
      console.log(chalk.gray('Install and start a monad to serve this gateway:\n'));
      console.log(chalk.white('  npm install -g monad.ai'));
      console.log(chalk.white('  monads start local\n'));
      console.log(chalk.green('✔ Init complete. Refresh your browser after starting the monad.\n'));

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
