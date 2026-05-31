import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import open from 'open';
import { getLocalIP, getPublicIP } from '../modules/utils/ipUtils.ts';
import {
    detectOpenRestyLayout,
    findOpenRestyBin,
    getOpenRestyStatus as getDetectedOpenRestyStatus,
    validateOpenRestyConfig
} from '../modules/NetGetX/OpenResty/platformDetect.ts';
import { getOpenRestyServiceStatus } from '../modules/NetGetX/OpenResty/openRestyService.ts';
import {
    getActiveStaticRoot,
    hasIndexHtml,
    resolveMainServerFrontendConfig,
} from '../modules/NetGetX/OpenResty/mainServerFrontend.ts';
import { getSelfSignedCertificateStatus } from '../modules/NetGetX/Domains/SSL/selfSignedCertificates.ts';

const LOCAL_NETGET_HOST = 'local.netget';
const HOSTS_FILE_PATH = os.platform() === 'win32'
    ? path.join(process.env.SystemRoot || '', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts';
const SELF_SIGNED_CERT_PATH = '/etc/ssl/certs/nginx-selfsigned.crt';
const SELF_SIGNED_KEY_PATH = '/etc/ssl/private/nginx-selfsigned.key';

type LocalChoice = 'snapshot' | 'public-ip' | 'activate' | 'start' | 'restart' | 'open-http' | 'open-https' | 'netgetx' | 'back';

type GatewayState = 'unsupported' | 'unconfigured' | 'stopped' | 'running';

async function getGatewayState(): Promise<GatewayState> {
    const layout = detectOpenRestyLayout();
    if (!layout.isSupported) return 'unsupported';

    const oresty = getOpenRestyStatus();
    const certOk = exists(SELF_SIGNED_CERT_PATH) && exists(SELF_SIGNED_KEY_PATH);
    const nginxOk = exists(layout.configFilePath);
    if (!oresty.installed || !certOk || !nginxOk) return 'unconfigured';
    const port80 = await checkLocalPort(80);
    return port80 ? 'running' : 'stopped';
}

interface PortProbe {
    port: number;
    label: string;
}

interface PortStatus extends PortProbe {
    listening: boolean;
}

const PORT_PROBES: PortProbe[] = [
    { port: 80, label: 'OpenResty HTTP' },
    { port: 443, label: 'OpenResty HTTPS' },
    { port: 3432, label: 'NetGet local output' },
    { port: 8161, label: 'Legacy monad.ai target' }
];

function exists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

function readJsonIfExists(filePath: string): Record<string, any> | null {
    if (!exists(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function getProbableDataDir(): string {
    if (os.platform() === 'linux' && exists('/opt/.get')) {
        return '/opt/.get';
    }

    return path.join(os.homedir(), '.get');
}

function findHostsEntry(hostname: string): string | null {
    try {
        const hostsContent = fs.readFileSync(HOSTS_FILE_PATH, 'utf8');
        const line = hostsContent
            .split(/\r?\n/)
            .find((item) => {
                const trimmed = item.trim();
                if (!trimmed || trimmed.startsWith('#')) {
                    return false;
                }

                return trimmed.split(/\s+/).includes(hostname);
            });

        return line?.trim() || null;
    } catch {
        return null;
    }
}

function getOpenRestyStatus(): { installed: boolean; version?: string } {
    const detected = getDetectedOpenRestyStatus();
    return { installed: detected.installed, version: detected.version };
}

async function checkLocalPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        let settled = false;

        const done = (listening: boolean) => {
            if (settled) {
                return;
            }

            settled = true;
            socket.destroy();
            resolve(listening);
        };

        socket.setTimeout(350);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

async function getPortStatuses(): Promise<PortStatus[]> {
    return Promise.all(PORT_PROBES.map(async (probe) => ({
        ...probe,
        listening: await checkLocalPort(probe.port)
    })));
}

function status(value: boolean, yes = 'yes', no = 'no'): string {
    return value ? chalk.green(yes) : chalk.yellow(no);
}

function printConfigSummary(dataDir: string): void {
    const xConfigPath = path.join(dataDir, 'xConfig.json');
    const domainsDbPath = path.join(dataDir, 'domains.db');
    const xConfig = readJsonIfExists(xConfigPath);

    console.log(chalk.cyan('\nRuntime files'));
    console.log(`  data dir: ${exists(dataDir) ? chalk.green(dataDir) : chalk.yellow(`${dataDir} (missing)`)}`);
    console.log(`  xConfig: ${status(!!xConfig, xConfigPath, 'missing')}`);
    console.log(`  domains.db: ${status(exists(domainsDbPath), domainsDbPath, 'missing')}`);

    if (xConfig) {
        console.log(`  mainServerName: ${xConfig.mainServerName || chalk.gray('not set')}`);
        console.log(`  sqliteDatabasePath: ${xConfig.sqliteDatabasePath || chalk.gray('not set')}`);
        console.log(`  xMainOutPutPort: ${xConfig.xMainOutPutPort || chalk.gray('not set')}`);
    }
}

export async function printLocalSnapshot(): Promise<void> {
    const dataDir = getProbableDataDir();
    const hostsEntry = findHostsEntry(LOCAL_NETGET_HOST);
    const openResty = getOpenRestyStatus();
    const layout = detectOpenRestyLayout();
    const service = await getOpenRestyServiceStatus();
    const cert = await getSelfSignedCertificateStatus();
    const frontend = resolveMainServerFrontendConfig();
    const activeStaticRoot = getActiveStaticRoot(frontend);
    const ports = await getPortStatuses();

    console.log(chalk.bold('\n📍 .Get Local'));
    console.log(chalk.bold('Local NetGet Environment'));
    console.log(chalk.gray('read-only snapshot; no hosts, certs, nginx, or config files are changed here'));

    console.log(chalk.cyan('\nMachine'));
    console.log(`  os: ${os.platform()} ${os.release()} (${os.arch()})`);
    console.log(`  user: ${os.userInfo().username}`);
    console.log(`  hostname: ${os.hostname()}`);
    console.log(`  LAN IP:   ${getLocalIP() || chalk.gray('not found')} ${chalk.gray('(run "Check network IPs" to see WAN)')}`);


    console.log(chalk.cyan(`\n${LOCAL_NETGET_HOST}`));
    console.log(`  hosts entry: ${hostsEntry ? chalk.green(hostsEntry) : chalk.yellow('missing')}`);
    console.log(`  OpenResty: ${openResty.installed ? chalk.green(openResty.version || 'installed') : chalk.yellow('not found')}`);
    console.log(`  OpenResty mode: ${service.mode === 'service' ? chalk.green(service.mode) : service.mode === 'manual' ? chalk.yellow(service.mode) : chalk.gray(service.mode)}`);
    if (layout.isSupported) {
        console.log(`  layout: ${chalk.gray(layout.layoutKey)}`);
        console.log(`  nginx.conf: ${status(exists(layout.configFilePath), layout.configFilePath, 'missing')}`);
    } else {
        console.log(`  OpenResty layout: ${chalk.yellow('unsupported')}`);
    }
    console.log(`  self-signed cert: ${status(exists(SELF_SIGNED_CERT_PATH), SELF_SIGNED_CERT_PATH, 'missing')}`);
    console.log(`  self-signed key: ${status(exists(SELF_SIGNED_KEY_PATH), SELF_SIGNED_KEY_PATH, 'missing')}`);
    if (cert.notAfter) console.log(`  local HTTPS expires: ${chalk.gray(cert.notAfter)}`);
    console.log(`  Main Server UI: ${chalk.green(frontend.mode)} ${
        frontend.mode === 'dev'
            ? chalk.gray(frontend.devUrl)
            : hasIndexHtml(activeStaticRoot)
                ? chalk.gray(activeStaticRoot)
                : chalk.yellow(`${activeStaticRoot} (missing index.html)`)
    }`);

    printConfigSummary(dataDir);

    console.log(chalk.cyan('\nLocal ports'));
    ports.forEach((item) => {
        console.log(`  ${item.port.toString().padEnd(5)} ${item.label}: ${status(item.listening, 'listening', 'closed')}`);
    });
    console.log('');
}

export async function printNetworkIPs(): Promise<void> {
    const lanIP = getLocalIP();
    const wanIP = await getPublicIP();

    console.log(chalk.cyan('\nNetwork IPs'));
    console.log(`  LAN  (machine interface): ${lanIP ? chalk.green(lanIP) : chalk.yellow('not found')}`);
    console.log(`  WAN  (as seen externally): ${wanIP ? chalk.green(wanIP) : chalk.yellow('not found')}`);

    if (lanIP && wanIP) {
        if (lanIP === wanIP) {
            console.log(chalk.gray('  -> same address: direct public IP, no NAT detected'));
        } else {
            console.log(chalk.gray('  -> behind NAT / router'));
        }
    }
    console.log('');
}

function canContinueAfterValidationFailure(output: string): boolean {
    return /permission denied|Permission denied|BIO_new_file|cannot load certificate key/i.test(output);
}

async function startOpenRestyIfNeeded(restart = false): Promise<void> {
    const layout = detectOpenRestyLayout();
    if (!layout.isSupported) {
        console.log(chalk.yellow('OpenResty cannot be managed automatically on this platform.'));
        if (layout.installNote) console.log(chalk.gray(layout.installNote));
        return;
    }

    const running = await checkLocalPort(80);
    if (running && !restart) {
        console.log(chalk.green('OpenResty is already running on port 80.'));
        return;
    }

    const bin = findOpenRestyBin();
    if (!bin) {
        console.log(chalk.yellow('OpenResty binary not found. Run the Main Server setup first.'));
        return;
    }

    if (!exists(layout.configFilePath)) {
        console.log(chalk.yellow(`nginx.conf is missing: ${layout.configFilePath}`));
        console.log(chalk.gray('Run setup to generate the platform-specific OpenResty config.'));
        return;
    }

    console.log(chalk.blue('Validating OpenResty configuration...'));
    const validation = validateOpenRestyConfig(bin);
    if (!validation.ok && !canContinueAfterValidationFailure(validation.output)) {
        console.log(chalk.red('OpenResty config validation failed. Not starting the gateway.'));
        console.log(chalk.gray(validation.output || '(no output)'));
        console.log(chalk.yellow('Repair path: Get Local > Main Server > OpenResty > reset/regenerate nginx.conf.'));
        return;
    }
    if (!validation.ok) {
        console.log(chalk.yellow('Config validation needs elevated file access; continuing with sudo start/reload.'));
        console.log(chalk.gray(validation.output || '(no output)'));
    } else {
        console.log(chalk.green('OpenResty configuration is valid.'));
    }

    const args = running && restart ? [bin, '-s', 'reload'] : [bin];
    console.log(chalk.blue(`${running && restart ? 'Reloading' : 'Starting'} OpenResty (${bin})...`));
    console.log(chalk.gray('Ports 80/443 require root - you may be prompted for your password.'));
    const r = spawnSync('sudo', args, { stdio: 'inherit' });

    if (!r.error && r.status === 0) {
        const port80 = await checkLocalPort(80);
        console.log(port80
            ? chalk.green(`OpenResty ${running && restart ? 'reloaded' : 'started'} and port 80 is listening.`)
            : chalk.yellow('OpenResty command finished, but port 80 is still closed.')
        );
    } else {
        const command = running && restart ? `sudo ${bin} -s reload` : `sudo ${bin}`;
        console.log(chalk.yellow(`Could not ${running && restart ? 'reload' : 'start'} OpenResty automatically.`));
        console.log(chalk.gray(`Run manually: ${command}`));
    }
}

async function activateLocalGateway(): Promise<void> {
    const { shouldActivate } = await inquirer.prompt<{ shouldActivate: boolean }>([
        {
            type: 'confirm',
            name: 'shouldActivate',
            message: [
                'Set up the Main Server gateway now?',
                'This can modify /etc/hosts, generate self-signed certs, verify/install OpenResty, and update nginx config.'
            ].join('\n'),
            default: false
        }
    ]);

    if (!shouldActivate) {
        console.log(chalk.yellow('Activation skipped.\n'));
        return;
    }

    const { i_DefaultNetGetX } = await import('../modules/NetGetX/config/i_DefaultNetGetX.ts');
    await i_DefaultNetGetX();

    const { ensureLocalNetgetSeed, generateDomainMap } = await import('../runtime/domainMap.ts');
    await ensureLocalNetgetSeed();
    const mapPath = await generateDomainMap();
    console.log(chalk.green(`Domain map written: ${mapPath}`));

    const { default: includeNetgetAppConf } = await import('../modules/NetGetX/OpenResty/includeNetgetAppConf.ts');
    await includeNetgetAppConf();

    await startOpenRestyIfNeeded();

    if (await checkLocalPort(80)) {
        console.log(chalk.green('\nMain Server gateway is running. Open http://local.netget in your browser.\n'));
    } else {
        console.log(chalk.yellow('\nSetup files are ready, but the gateway is not listening on port 80 yet.'));
        console.log(chalk.gray('Use "Start Main Server gateway" or run the printed sudo command manually.\n'));
    }
}

export async function localMenu(): Promise<void> {
    console.clear();

    while (true) {
        const state = await getGatewayState();

        if (state === 'running' || state === 'stopped') {
            const { default: NetGetX_CLI } = await import('../modules/NetGetX/NetGetX.cli.ts');
            await NetGetX_CLI();
            return;
        }

        const gatewayChoice =
            state === 'unsupported'
                ? { name: chalk.yellow('OpenResty requires WSL2 on Windows'), value: 'snapshot' }
                : { name: 'Set up Main Server gateway', value: 'activate' };

        const { localChoice } = await inquirer.prompt<{ localChoice: LocalChoice }>([
            {
                name: 'localChoice',
                type: 'list',
                message: '📍 .Get Local - choose an option:',
                choices: [
                    { name: 'View local environment snapshot', value: 'snapshot' },
                    { name: 'Check network IPs (LAN / WAN)', value: 'public-ip' },
                    new inquirer.Separator(),
                    gatewayChoice,
                    new inquirer.Separator(),
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (localChoice === 'snapshot') {
            await printLocalSnapshot();
        } else if (localChoice === 'public-ip') {
            await printNetworkIPs();
        } else if (localChoice === 'activate') {
            await activateLocalGateway();
        } else if (localChoice === 'start') {
            await startOpenRestyIfNeeded();
        } else if (localChoice === 'restart') {
            await startOpenRestyIfNeeded(true);
        } else if (localChoice === 'open-http') {
            await open('http://local.netget');
        } else if (localChoice === 'open-https') {
            await open('https://local.netget');
        } else if (localChoice === 'netgetx') {
            const { default: NetGetX_CLI } = await import('../modules/NetGetX/NetGetX.cli.ts');
            await NetGetX_CLI();
        } else {
            return;
        }
    }
}
