import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface OpenRestyLayout {
    layoutKey:      'homebrew-arm' | 'homebrew-intel' | 'linux-apt' | 'linux-source' | 'unsupported';
    configDir:      string;
    confDDir:       string;
    logDir:         string;
    configFilePath: string;
    luaDir:         string;
    luaPackagePath: string;
    userDirective:  string;
    isSupported:    boolean;
    installNote?:   string;
}

export interface OpenRestyStatus {
    installed: boolean;
    bin?:      string;
    version?:  string;
}

export const OPENRESTY_CANDIDATES: string[] = [
    'openresty',
    '/opt/homebrew/bin/openresty',
    '/usr/local/bin/openresty',
    '/usr/local/openresty/bin/openresty',
    '/usr/sbin/openresty',
];

export function findOpenRestyBin(): string | null {
    for (const bin of OPENRESTY_CANDIDATES) {
        const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
        if (!r.error && r.status === 0) return bin;
    }
    return null;
}

export function getOpenRestyStatus(): OpenRestyStatus {
    const bin = findOpenRestyBin();
    if (!bin) return { installed: false };

    const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    const version = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return { installed: true, bin, version: version || undefined };
}

export function validateOpenRestyConfig(bin: string): { ok: boolean; output: string } {
    const r = spawnSync(bin, ['-t'], { encoding: 'utf8' });
    const output = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return { ok: !r.error && r.status === 0, output };
}

function getOpenRestyBuildOutput(bin: string): string {
    const r = spawnSync(bin, ['-V'], { encoding: 'utf8' });
    return `${r.stdout || ''}${r.stderr || ''}`;
}

function readBuildFlag(output: string, flag: string): string | null {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = output.match(new RegExp(`${escaped}=([^\\s]+)`));
    return match?.[1] || null;
}

function linuxUserDirective(): string {
    try {
        const passwd = fs.readFileSync('/etc/passwd', 'utf8');
        if (/^www-data:/m.test(passwd)) return 'user www-data;';
        if (/^nginx:/m.test(passwd)) return 'user nginx;';
        if (/^nobody:/m.test(passwd)) return 'user nobody;';
    } catch {
        // No directive is safer than generating a config with a missing OS user.
    }
    return '';
}

function layoutFromInstalledBinary(bin: string): OpenRestyLayout | null {
    const build = getOpenRestyBuildOutput(bin);
    const confPath = readBuildFlag(build, '--conf-path');
    if (!confPath) return null;

    const prefix = readBuildFlag(build, '--prefix') || path.dirname(path.dirname(confPath));
    const httpLogPath = readBuildFlag(build, '--http-log-path');
    const configDir = path.dirname(confPath);
    const logDir = httpLogPath ? path.dirname(httpLogPath) : path.join(prefix, 'logs');
    const luaDir = path.join(prefix, 'lua');
    const lualibDir = path.join(path.dirname(prefix), 'lualib');

    let layoutKey: OpenRestyLayout['layoutKey'] = 'linux-source';
    if (confPath.startsWith('/opt/homebrew/')) layoutKey = 'homebrew-arm';
    else if (confPath.startsWith('/usr/local/etc/openresty/')) layoutKey = 'homebrew-intel';
    else if (confPath.startsWith('/etc/openresty/')) layoutKey = 'linux-apt';

    return {
        layoutKey,
        configDir,
        confDDir: path.join(configDir, 'conf.d'),
        logDir,
        configFilePath: confPath,
        luaDir,
        luaPackagePath: [
            `${lualibDir}/?.lua`,
            `${lualibDir}/?/init.lua`,
            `${luaDir}/?.lua`,
            `${luaDir}/?/init.lua`,
            ''
        ].join(';'),
        userDirective: process.platform === 'linux' ? linuxUserDirective() : '',
        isSupported: true,
    };
}

export function detectOpenRestyLayout(): OpenRestyLayout {
    const platform = process.platform;

    if (platform === 'win32') {
        return {
            layoutKey: 'unsupported',
            configDir: '', confDDir: '', logDir: '', configFilePath: '', luaDir: '', luaPackagePath: '',
            userDirective: '',
            isSupported: false,
            installNote: [
                'OpenResty is not natively supported on Windows.',
                'Use WSL2 (Windows Subsystem for Linux) instead:',
                '  1. Open PowerShell as Administrator',
                '  2. Run:  wsl --install',
                '  3. Restart, open a WSL terminal',
                '  4. Run netget inside WSL - it behaves like Linux.',
            ].join('\n'),
        };
    }

    const installedBin = findOpenRestyBin();
    if (installedBin) {
        const installedLayout = layoutFromInstalledBinary(installedBin);
        if (installedLayout) return installedLayout;
    }

    if (platform === 'darwin') {
        // Homebrew Apple Silicon: brew prefix is /opt/homebrew
        if (fs.existsSync('/opt/homebrew/etc/openresty')) {
            return {
                layoutKey: 'homebrew-arm',
                configDir:      '/opt/homebrew/etc/openresty',
                confDDir:       '/opt/homebrew/etc/openresty/conf.d',
                logDir:         '/opt/homebrew/var/log/nginx',
                configFilePath: '/opt/homebrew/etc/openresty/nginx.conf',
                luaDir:         '/opt/homebrew/opt/openresty/nginx/lua',
                luaPackagePath: '/opt/homebrew/opt/openresty/lualib/?.lua;/opt/homebrew/opt/openresty/lualib/?/init.lua;/opt/homebrew/opt/openresty/nginx/lua/?.lua;/opt/homebrew/opt/openresty/nginx/lua/?/init.lua;;',
                userDirective:  '',
                isSupported:    true,
            };
        }
        // Homebrew Intel Mac: brew prefix is /usr/local
        if (fs.existsSync('/usr/local/etc/openresty')) {
            return {
                layoutKey: 'homebrew-intel',
                configDir:      '/usr/local/etc/openresty',
                confDDir:       '/usr/local/etc/openresty/conf.d',
                logDir:         '/usr/local/var/log/nginx',
                configFilePath: '/usr/local/etc/openresty/nginx.conf',
                luaDir:         '/usr/local/opt/openresty/nginx/lua',
                luaPackagePath: '/usr/local/opt/openresty/lualib/?.lua;/usr/local/opt/openresty/lualib/?/init.lua;/usr/local/opt/openresty/nginx/lua/?.lua;/usr/local/opt/openresty/nginx/lua/?/init.lua;;',
                userDirective:  '',
                isSupported:    true,
            };
        }
        const brewPrefix = os.arch() === 'arm64' ? '/opt/homebrew' : '/usr/local';
        return {
            layoutKey: os.arch() === 'arm64' ? 'homebrew-arm' : 'homebrew-intel',
            configDir:      `${brewPrefix}/etc/openresty`,
            confDDir:       `${brewPrefix}/etc/openresty/conf.d`,
            logDir:         `${brewPrefix}/var/log/nginx`,
            configFilePath: `${brewPrefix}/etc/openresty/nginx.conf`,
            luaDir:         `${brewPrefix}/opt/openresty/nginx/lua`,
            luaPackagePath: `${brewPrefix}/opt/openresty/lualib/?.lua;${brewPrefix}/opt/openresty/lualib/?/init.lua;${brewPrefix}/opt/openresty/nginx/lua/?.lua;${brewPrefix}/opt/openresty/nginx/lua/?/init.lua;;`,
            userDirective:  '',
            isSupported:    true,
        };
    }

    // Linux: OpenResty official apt package
    if (fs.existsSync('/etc/openresty')) {
        return {
            layoutKey: 'linux-apt',
            configDir:      '/etc/openresty',
            confDDir:       '/etc/openresty/conf.d',
            logDir:         '/var/log/nginx',
            configFilePath: '/etc/openresty/nginx.conf',
            luaDir:         '/usr/local/openresty/nginx/lua',
            luaPackagePath: '/usr/local/openresty/lualib/?.lua;/usr/local/openresty/lualib/?/init.lua;/usr/local/openresty/nginx/lua/?.lua;/usr/local/openresty/nginx/lua/?/init.lua;/usr/share/lua/5.1/?.lua;;',
            userDirective:  linuxUserDirective(),
            isSupported:    true,
        };
    }

    // Linux: source build (default install prefix /usr/local/openresty)
    return {
        layoutKey: 'linux-source',
        configDir:      '/usr/local/openresty/nginx/conf',
        confDDir:       '/usr/local/openresty/nginx/conf/conf.d',
        logDir:         '/usr/local/openresty/nginx/logs',
        configFilePath: '/usr/local/openresty/nginx/conf/nginx.conf',
        luaDir:         '/usr/local/openresty/nginx/lua',
        luaPackagePath: '/usr/local/openresty/lualib/?.lua;/usr/local/openresty/lualib/?/init.lua;/usr/local/openresty/nginx/lua/?.lua;/usr/local/openresty/nginx/lua/?/init.lua;/usr/local/share/lua/5.1/?.lua;;',
        userDirective:  linuxUserDirective(),
        isSupported:    true,
    };
}

export function getInstallInstructions(): string {
    const arch = os.arch();

    if (process.platform === 'win32') {
        return detectOpenRestyLayout().installNote || '';
    }

    if (process.platform === 'darwin') {
        return [
            'Install via Homebrew:',
            '  brew install openresty/brew/openresty',
            '',
            'Homebrew not installed? Run:',
            '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        ].join('\n');
    }

    if (arch === 'arm64' || arch === 'arm') {
        return [
            'ARM Linux (Raspberry Pi / NVIDIA Jetson):',
            '  Check https://openresty.org/en/linux-packages.html for prebuilt ARM packages.',
            '',
            'Or build from source:',
            '  curl -fSL https://openresty.org/download/openresty-1.27.1.1.tar.gz | tar xz',
            '  cd openresty-1.27.1.1 && ./configure -j2 && make -j2 && sudo make install',
        ].join('\n');
    }

    return [
        'Install via apt (Ubuntu/Debian):',
        '  wget -qO - https://openresty.org/package/pubkey.gpg | sudo apt-key add -',
        '  echo "deb http://openresty.org/package/ubuntu $(lsb_release -sc) main" | sudo tee /etc/apt/sources.list.d/openresty.list',
        '  sudo apt update && sudo apt install openresty',
    ].join('\n');
}
