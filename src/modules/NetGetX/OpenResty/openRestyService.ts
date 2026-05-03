import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { detectOpenRestyLayout, findOpenRestyBin, validateOpenRestyConfig } from './platformDetect.ts';

export type OpenRestyRunMode = 'service' | 'manual' | 'stopped' | 'unsupported' | 'unknown';

export interface OpenRestyServiceStatus {
    platform: NodeJS.Platform;
    bin: string | null;
    serviceName: string;
    serviceInstalled: boolean;
    serviceActive: boolean;
    httpListening: boolean;
    httpsListening: boolean;
    mode: OpenRestyRunMode;
    detail: string;
}

const SERVICE_NAME = 'com.netget.openresty';
const MACOS_PLIST_PATH = `/Library/LaunchDaemons/${SERVICE_NAME}.plist`;
const LINUX_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

function run(command: string, args: string[] = []): { ok: boolean; output: string; status: number | null } {
    const r = spawnSync(command, args, { encoding: 'utf8' });
    return {
        ok: !r.error && r.status === 0,
        output: `${r.stdout || ''}${r.stderr || ''}`.trim(),
        status: r.status,
    };
}

function runSudoShell(command: string): boolean {
    const r = spawnSync('sudo', ['sh', '-c', command], { stdio: 'inherit' });
    return !r.error && r.status === 0;
}

function canUseSystemd(): boolean {
    return fs.existsSync('/bin/systemctl') || fs.existsSync('/usr/bin/systemctl');
}

function canContinueAfterValidationFailure(output: string): boolean {
    return /permission denied|Permission denied|BIO_new_file|cannot load certificate key/i.test(output);
}

function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        let settled = false;
        const done = (ok: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(350);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

function buildMacOSPlist(bin: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>-g</string>
    <string>daemon off;</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/${SERVICE_NAME}.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${SERVICE_NAME}.err.log</string>
</dict>
</plist>
`;
}

function buildLinuxUnit(bin: string): string {
    return `[Unit]
Description=NetGet OpenResty Gateway
After=network.target

[Service]
Type=simple
ExecStart=${bin} -g 'daemon off;'
ExecReload=${bin} -s reload
ExecStop=${bin} -s quit
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`;
}

export async function getOpenRestyServiceStatus(): Promise<OpenRestyServiceStatus> {
    const bin = findOpenRestyBin();
    const httpListening = await checkPort(80);
    const httpsListening = await checkPort(443);

    if (process.platform === 'win32') {
        return {
            platform: process.platform,
            bin,
            serviceName: SERVICE_NAME,
            serviceInstalled: false,
            serviceActive: false,
            httpListening,
            httpsListening,
            mode: 'unsupported',
            detail: 'Use WSL2 for OpenResty service management.',
        };
    }

    if (process.platform === 'darwin') {
        const serviceInstalled = fs.existsSync(MACOS_PLIST_PATH);
        const printed = run('launchctl', ['print', `system/${SERVICE_NAME}`]);
        const serviceActive = printed.ok;
        const mode: OpenRestyRunMode = serviceActive
            ? 'service'
            : httpListening || httpsListening
                ? 'manual'
                : 'stopped';
        return {
            platform: process.platform,
            bin,
            serviceName: SERVICE_NAME,
            serviceInstalled,
            serviceActive,
            httpListening,
            httpsListening,
            mode,
            detail: serviceActive ? 'launchd service is active.' : serviceInstalled ? 'launchd service is installed but not active.' : 'launchd service is not installed.',
        };
    }

    if (process.platform === 'linux') {
        const serviceInstalled = fs.existsSync(LINUX_UNIT_PATH);
        const active = canUseSystemd() ? run('systemctl', ['is-active', '--quiet', SERVICE_NAME]) : { ok: false, output: '', status: 1 };
        const serviceActive = active.ok;
        const mode: OpenRestyRunMode = serviceActive
            ? 'service'
            : httpListening || httpsListening
                ? 'manual'
                : 'stopped';
        return {
            platform: process.platform,
            bin,
            serviceName: SERVICE_NAME,
            serviceInstalled,
            serviceActive,
            httpListening,
            httpsListening,
            mode,
            detail: serviceActive ? 'systemd service is active.' : serviceInstalled ? 'systemd service is installed but not active.' : 'systemd service is not installed.',
        };
    }

    return {
        platform: process.platform,
        bin,
        serviceName: SERVICE_NAME,
        serviceInstalled: false,
        serviceActive: false,
        httpListening,
        httpsListening,
        mode: 'unknown',
        detail: 'Unsupported platform.',
    };
}

export async function startOpenRestyOnce(reloadIfRunning = false): Promise<boolean> {
    const bin = findOpenRestyBin();
    if (!bin) throw new Error('OpenResty binary not found.');

    const layout = detectOpenRestyLayout();
    if (!layout.isSupported) throw new Error(layout.installNote || 'OpenResty is not supported on this platform.');

    const validation = validateOpenRestyConfig(bin);
    if (!validation.ok && !canContinueAfterValidationFailure(validation.output)) {
        throw new Error(`OpenResty config validation failed:\n${validation.output || '(no output)'}`);
    }

    const status = await getOpenRestyServiceStatus();
    const command = (status.httpListening || status.httpsListening) && reloadIfRunning
        ? `"${bin}" -s reload`
        : `"${bin}"`;
    return runSudoShell(command);
}

export async function installOpenRestyService(): Promise<boolean> {
    const bin = findOpenRestyBin();
    if (!bin) throw new Error('OpenResty binary not found.');

    const validation = validateOpenRestyConfig(bin);
    if (!validation.ok && !canContinueAfterValidationFailure(validation.output)) {
        throw new Error(`OpenResty config validation failed:\n${validation.output || '(no output)'}`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-openresty-service-'));

    if (process.platform === 'darwin') {
        const tmpPlist = path.join(tmpDir, `${SERVICE_NAME}.plist`);
        fs.writeFileSync(tmpPlist, buildMacOSPlist(bin), 'utf8');
        return runSudoShell([
            `cp "${tmpPlist}" "${MACOS_PLIST_PATH}"`,
            `chown root:wheel "${MACOS_PLIST_PATH}"`,
            `chmod 644 "${MACOS_PLIST_PATH}"`,
            `launchctl bootout system "${MACOS_PLIST_PATH}" >/dev/null 2>&1 || true`,
            `launchctl bootstrap system "${MACOS_PLIST_PATH}"`,
            `launchctl enable system/${SERVICE_NAME}`,
            `launchctl kickstart -k system/${SERVICE_NAME}`,
        ].join(' && '));
    }

    if (process.platform === 'linux') {
        if (!canUseSystemd()) throw new Error('systemd was not found on this Linux system.');
        const tmpUnit = path.join(tmpDir, `${SERVICE_NAME}.service`);
        fs.writeFileSync(tmpUnit, buildLinuxUnit(bin), 'utf8');
        return runSudoShell([
            `cp "${tmpUnit}" "${LINUX_UNIT_PATH}"`,
            'systemctl daemon-reload',
            `systemctl enable --now ${SERVICE_NAME}`,
        ].join(' && '));
    }

    throw new Error('OpenResty service installation is only supported on macOS and Linux.');
}

export async function removeOpenRestyService(): Promise<boolean> {
    if (process.platform === 'darwin') {
        return runSudoShell([
            `launchctl bootout system "${MACOS_PLIST_PATH}" >/dev/null 2>&1 || true`,
            `rm -f "${MACOS_PLIST_PATH}"`,
        ].join(' && '));
    }

    if (process.platform === 'linux') {
        if (!canUseSystemd()) throw new Error('systemd was not found on this Linux system.');
        return runSudoShell([
            `systemctl disable --now ${SERVICE_NAME} >/dev/null 2>&1 || true`,
            `rm -f "${LINUX_UNIT_PATH}"`,
            'systemctl daemon-reload',
        ].join(' && '));
    }

    throw new Error('OpenResty service removal is only supported on macOS and Linux.');
}
