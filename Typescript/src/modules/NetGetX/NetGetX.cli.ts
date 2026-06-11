//netget/src/modules/NetGetX/NetGetX.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import open from 'open';
import { loadOrCreateXConfig } from './config/xConfig.ts';
import type { XStateData } from './xState.ts';
import netGetXSettingsMenu from './NetGetX_Settings.cli.ts';
import domainsMenu from './Domains/domains.cli.ts';
import routingTableMenu from './Domains/routingTable.cli.ts';
import reportedAppsMenu from './Apps/reportedApps.cli.ts';
import openRestyInstallationOptions from './OpenResty/openRestyInstallationOptions.cli.ts';
import includeNetgetAppConf from './OpenResty/includeNetgetAppConf.ts';
import {
    getOpenRestyServiceStatus,
    installOpenRestyService,
    stopOpenRestyGateway,
    waitForOpenRestyGateway,
    type OpenRestyServiceStatus,
} from './OpenResty/openRestyService.ts';
import { getSelfSignedCertificateStatus } from './Domains/SSL/selfSignedCertificates.ts';
import { isMkcertCAInstalled, isCertMkcertSigned, ensureMkcertCert } from './Domains/SSL/mkcert/mkcert.ts';
import { GatewayClaimsManager } from './Auth/GatewayClaimsManager.ts';
import fs from 'fs';

interface MenuAnswers {
    option: string;
}

type MainServerChoice =
    | 'domains'
    | 'apps'
    | 'routing'
    | 'toggle-netget'
    | 'refresh-gateway'
    | 'setup-https'
    | 'open-http'
    | 'open-https'
    | 'settings'
    | 'snapshot'
    | 'network-ips'
    | 'back'
    | 'exit';

const CERT_PATH = '/etc/ssl/certs/nginx-selfsigned.crt';
const KEY_PATH  = '/etc/ssl/private/nginx-selfsigned.key';

/** True only when the cert on disk was actually signed by the local mkcert CA. */
function httpsIsReady(): boolean {
    return isMkcertCAInstalled() && isCertMkcertSigned();
}

function isPrivateIPv4(ip: string): boolean {
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    const match = ip.match(/^172\.(\d+)\./);
    if (match) {
        const n = Number(match[1]);
        return n >= 16 && n <= 31;
    }
    return /^127\./.test(ip) || /^169\.254\./.test(ip);
}

function publicDomainApplies(x: XStateData): boolean {
    // See mainServer.cli.ts getExposure(): a server is directly publicly
    // reachable if its public IP is itself a non-private address, even when
    // the local IP differs (cloud VMs behind 1:1 NAT, e.g. GCP/AWS).
    const publicIP = String(x?.publicIP || '').trim();
    return !!publicIP && !isPrivateIPv4(publicIP);
}

function isNetGetOnline(service: OpenRestyServiceStatus): boolean {
    return service.httpListening || service.httpsListening;
}

/**
 * OSC 8 hyperlink — clicking opens in browser on iTerm2, VS Code terminal,
 * macOS Terminal 4+, Hyper, WezTerm, etc.
 * Degrades gracefully on non-supporting terminals (just shows the text).
 */
function termLink(text: string, url: string): string {
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function netGetStatusLabel(service: OpenRestyServiceStatus): string {
    if (isNetGetOnline(service)) return chalk.green('NetGet ON');
    return chalk.red('NetGet OFF');
}

function netGetStatusDetail(service: OpenRestyServiceStatus): string {
    const ports = [
        service.httpListening ? chalk.green('80') : chalk.gray('80 off'),
        service.httpsListening ? chalk.green('443') : chalk.gray('443 off'),
    ].join('/');

    if (isNetGetOnline(service)) {
        return `${netGetStatusLabel(service)} ${chalk.gray(`ports ${ports}`)}`;
    }
    if (service.serviceActive || service.serviceInstalled) {
        return `${netGetStatusLabel(service)} ${chalk.gray(`service configured, ports ${ports}`)}`;
    }
    return `${netGetStatusLabel(service)} ${chalk.gray(`ports ${ports}`)}`;
}

function netGetToggleChoice(service: OpenRestyServiceStatus): string {
    return isNetGetOnline(service)
        ? `${chalk.green('NetGet ON')} - turn OFF`
        : `${chalk.red('NetGet OFF')} - turn ON`;
}

function printMainServerHeader(x: XStateData, service: OpenRestyServiceStatus, message?: string): void {
    const domainLabel = publicDomainApplies(x) ? 'publicDomain' : 'localLabel';

    // Prefer http while gateway is online (avoids SSL warning); fall back to
    // https only when 80 is closed but 443 is up.
    const proto = service.httpListening ? 'http' : 'https';
    const online = isNetGetOnline(service);

    const publicIPDisplay = x?.publicIP
        ? chalk.green(online ? termLink(x.publicIP, `${proto}://${x.publicIP}`) : x.publicIP)
        : chalk.gray('Not Set');

    const localIPDisplay = x?.localIP
        ? chalk.green(online ? termLink(x.localIP, `${proto}://${x.localIP}`) : x.localIP)
        : chalk.gray('Not Set');

    const serverName = x?.mainServerName;
    const serverNameDisplay = serverName
        ? chalk.green(online ? termLink(serverName, `${proto}://${serverName}`) : serverName)
        : chalk.gray('Not Set');

    console.log(chalk.bold('📍 .Local Main Server'));
    console.log(chalk.bold('Main Server X:'));
    console.log(`
     ██╗  ██╗
     ╚██╗██╔╝ .publicIP: ${publicIPDisplay}
      ╚███╔╝  .localIP: ${localIPDisplay}
      ██╔██╗  .${domainLabel}: ${serverNameDisplay}
     ██╔╝ ██╗
     ╚═╝  ╚═╝ `);
    console.log(`Gateway: ${netGetStatusDetail(service)}`);

    const mainServerSet: boolean = !!(x.mainServerName && typeof x.mainServerName === 'string' && x.mainServerName.trim() !== '');
    if (!mainServerSet) {
        console.log(chalk.yellow('Public domain/local label is not set. In local/NAT mode this is optional.'));
    }
    if (message) console.log(`\n${message}`);
    console.log('');
}

async function pause(message = 'Press Enter to return to Main Server.'): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: 'continue', message }]);
}

// ---------------------------------------------------------------------------
// Minimal TTY spinner — no external deps
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(msg: string): NodeJS.Timeout {
    let i = 0;
    process.stdout.write(`\n${chalk.cyan(SPINNER_FRAMES[0])} ${msg}`);
    return setInterval(() => {
        process.stdout.write(`\r${chalk.cyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${msg}`);
    }, 80);
}

function stopSpinner(timer: NodeJS.Timeout, finalLine: string): void {
    clearInterval(timer);
    process.stdout.write(`\r${finalLine}\n`);
}

/**
 * NetGetX_CLI
 * @memberof module:NetGetX 
 */
/**
 * ensureGatewayReady — silent bootstrap on first entry.
 *
 * Runs automatically when the gateway is not online:
 *   1. Generate HTTPS cert (mkcert / self-signed)
 *   2. Write gateway config (netget_app.conf + nginx.conf)
 *   3. Install & start OpenResty service
 *
 * No user interaction required unless sudo fails.
 * Idempotent — safe to call every time; each step is a no-op if already done.
 */
async function ensureGatewayReady(): Promise<string> {
    const service = await getOpenRestyServiceStatus();
    if (isNetGetOnline(service)) return '';

    console.log(chalk.cyan('\n⚡ Gateway is offline — running auto-setup…\n'));

    // Step 1: HTTPS cert
    const spinner1 = startSpinner('[1/3] Generating HTTPS cert…');
    const httpsResult = ensureMkcertCert();
    stopSpinner(spinner1, httpsResult.ok
        ? chalk.green('  ✔ HTTPS cert ready.')
        : chalk.yellow(`  ⚠  HTTPS skipped: ${httpsResult.message}`));

    // Step 2: Write gateway config (picks up public IP, local IP, hostname)
    const spinner2 = startSpinner('[2/3] Writing gateway config…');
    await includeNetgetAppConf();
    stopSpinner(spinner2, chalk.green('  ✔ Config written.'));

    // Step 3: Install & start OpenResty
    const spinner3 = startSpinner('[3/3] Starting gateway service (may need sudo)…');
    const installed = await installOpenRestyService();
    stopSpinner(spinner3, installed
        ? chalk.green('  ✔ Gateway service started.')
        : chalk.yellow('  ⚠  Gateway service failed — try "NetGet ON" manually.'));

    if (installed) {
        const waitTimer = startSpinner('Waiting for ports 80/443…');
        const next = await waitForOpenRestyGateway();
        const online = isNetGetOnline(next);
        stopSpinner(waitTimer, online
            ? chalk.green('  ✔ Gateway listening on 80/443.')
            : chalk.yellow(`  ⚠  Ports not responding yet. ${next.detail}`));
        return online ? chalk.green('Gateway auto-started ✔') : '';
    }
    return '';
}

export default async function NetGetX_CLI(x?: XStateData): Promise<void> {
    if (!x) {
        x = await loadOrCreateXConfig() as XStateData;
    }

    // Auto-bootstrap on first entry if gateway is not running
    let lastMessage = await ensureGatewayReady();

    while (true) {
        console.clear();
        const service = await getOpenRestyServiceStatus();
        printMainServerHeader(x, service, lastMessage);
        lastMessage = '';

        const httpsReady = httpsIsReady();
        const answers = await inquirer.prompt<MenuAnswers>({
            type: 'list',
            name: 'option',
            message: 'Main Server',
            choices: [
                { name: netGetToggleChoice(service), value: 'toggle-netget' },
                { name: 'Refresh NetGet gateway config', value: 'refresh-gateway' },
                ...(!httpsReady ? [
                    { name: chalk.yellow('⚠  Setup HTTPS for local.netget'), value: 'setup-https' },
                ] : []),
                new inquirer.Separator(),
                { name: 'Domains & Certificates', value: 'domains' },
                { name: 'Local Apps', value: 'apps' },
                { name: 'Routing table', value: 'routing' },
                { name: 'Open http://local.netget',  value: 'open-http'  },
                { name: 'Open https://local.netget', value: 'open-https' },
                { name: 'Settings', value: 'settings' },
                new inquirer.Separator(),
                { name: 'View local environment snapshot', value: 'snapshot' },
                { name: 'Check network IPs (LAN / WAN)', value: 'network-ips' },
                new inquirer.Separator(),
                { name: 'Back', value: 'back' },
                { name: 'Exit', value: 'exit' }
            ]
        });

        switch (answers.option as MainServerChoice) {
            case 'toggle-netget':
                if (isNetGetOnline(service)) {
                    console.log(chalk.cyan('\nStopping gateway…'));
                    const stopped = await stopOpenRestyGateway();
                    lastMessage = stopped
                        ? chalk.red('NetGet OFF: gateway stopped and service removed.')
                        : chalk.yellow('NetGet OFF did not finish successfully.');
                } else {
                    // ── Bootstrap check ───────────────────────────────────
                    const claimsMgr = new GatewayClaimsManager();
                    if (claimsMgr.needsBootstrap()) {
                        const { runBootstrapWizard } = await import('./Auth/bootstrapWizard.cli.ts');
                        const ownerHash = await runBootstrapWizard();
                        if (!ownerHash) {
                            lastMessage = chalk.yellow('Bootstrap cancelled. NetGet was not started.');
                            break;
                        }
                        console.log('');
                    }

                    // ── Step 1: HTTPS cert ────────────────────────────────
                    console.log(chalk.cyan('\n[1/4] Setting up HTTPS cert…'));
                    const httpsResult = ensureMkcertCert();
                    console.log(httpsResult.ok
                        ? chalk.green('  ✔ HTTPS cert ready.')
                        : chalk.yellow(`  ⚠  HTTPS skipped: ${httpsResult.message}`));

                    // ── Step 2: gateway config ────────────────────────────
                    console.log(chalk.cyan('[2/4] Writing gateway config…'));
                    await includeNetgetAppConf();
                    console.log(chalk.green('  ✔ Config written.'));

                    // ── Step 3: install & start service (sudo prompt here) ─
                    console.log(chalk.cyan('[3/4] Installing gateway service (sudo required)…'));
                    const installed = await installOpenRestyService();

                    if (installed) {
                        // ── Step 4: wait for ports ────────────────────────
                        const waitTimer = startSpinner('[4/4] Waiting for gateway to come online…');
                        const next = await waitForOpenRestyGateway();
                        const online = isNetGetOnline(next);
                        stopSpinner(waitTimer, online
                            ? chalk.green('  ✔ Gateway is listening on ports 80/443.')
                            : chalk.yellow(`  ⚠  Gateway ports not responding. ${next.detail}`));

                        const httpsNote = httpsResult.ok
                            ? chalk.green(' HTTPS ready.')
                            : chalk.yellow(` HTTPS skipped: ${httpsResult.message}`);
                        lastMessage = online
                            ? chalk.green('NetGet ON: gateway is listening and will auto-start after reboot.') + httpsNote
                            : chalk.yellow(`NetGet service was configured, but the gateway is not listening yet. ${next.detail}`);
                    } else {
                        lastMessage = chalk.yellow('NetGet ON did not finish successfully.');
                    }
                }
                break;
            case 'refresh-gateway':
                await includeNetgetAppConf();
                lastMessage = chalk.green('NetGet gateway config refreshed.');
                break;
            case 'setup-https': {
                const { default: localHttpsMenu } = await import('./Domains/SSL/selfSigned/localHttps.cli.ts');
                await localHttpsMenu();
                break;
            }
            case 'domains':
                await domainsMenu();
                break;
            case 'apps':
                await reportedAppsMenu();
                break;
            case 'routing':
                await routingTableMenu();
                break;
            case 'open-http':
                await open('http://local.netget');
                lastMessage = chalk.green('Opened http://local.netget');
                break;
            case 'open-https': {
                const certStatus = await getSelfSignedCertificateStatus();
                if (certStatus.certExists && certStatus.keyExists && service.httpsListening) {
                    await open('https://local.netget');
                    lastMessage = chalk.green('Opened https://local.netget');
                } else {
                    await open('http://local.netget');
                    lastMessage = chalk.yellow(
                        'No HTTPS cert yet — opened http://local.netget instead.\n' +
                        chalk.gray('  → Settings → Domains & Certificates → Local HTTPS → Setup trusted HTTPS (mkcert)')
                    );
                }
                break;
            }
            case 'settings':
                await netGetXSettingsMenu(x);
                break;
            case 'snapshot': {
                console.clear();
                const { printLocalSnapshot } = await import('../../utils/localEnvironment.cli.ts');
                await printLocalSnapshot();
                await pause();
                break;
            }
            case 'network-ips': {
                console.clear();
                console.log(chalk.bold('📍 .Local Main Server > Network IPs'));
                const { printNetworkIPs } = await import('../../utils/localEnvironment.cli.ts');
                await printNetworkIPs();
                await pause();
                break;
            }
            case 'back':
                console.clear();
                return;
            case 'exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit(0);
            default:
                console.log(chalk.red('Invalid choice, please try again.'));
        }
    }
}
