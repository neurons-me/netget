import chalk from 'chalk';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handlePermission } from '../../utils/handlePermissions.ts';
import includeNetgetAppConf from './includeNetgetAppConf.ts';
import verifyOpenRestyInstallation from './verifyOpenRestyInstallation.ts';
import { ensureNginxConfigFile, setNginxConfigFile } from './setNginxConfigFile.ts';
import {
    detectOpenRestyLayout,
    getInstallInstructions,
    getOpenRestyStatus
} from './platformDetect.ts';
import {
    getOpenRestyServiceStatus,
    installOpenRestyService,
    removeOpenRestyService,
    startOpenRestyOnce,
    type OpenRestyServiceStatus,
} from './openRestyService.ts';
import mainServerFrontendMenu from './mainServerFrontend.cli.ts';

type InstallChoice =
    | 'verify'
    | 'install-homebrew'
    | 'install-apt'
    | 'install-source'
    | 'include-conf'
    | 'repair-config'
    | 'instructions'
    | 'status'
    | 'start-once'
    | 'install-service'
    | 'remove-service'
    | 'frontend'
    | 'local-https'
    | 'back';

interface InstallAnswers {
    choice: InstallChoice;
}

const BREADCRUMB = '📍 .Get Local > Main Server > OpenResty';

function commandExists(command: string): boolean {
    try {
        execSync(`command -v ${command}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function postInstallCheck(): Promise<void> {
    const installed = await verifyOpenRestyInstallation();
    if (!installed) {
        console.log(chalk.yellow('OpenResty was not detected after the install attempt.'));
        console.log(chalk.gray(getInstallInstructions()));
        return;
    }

    const layout = detectOpenRestyLayout();
    if (!layout.isSupported) return;

    if (fs.existsSync(layout.configFilePath)) {
        await setNginxConfigFile();
    } else {
        await ensureNginxConfigFile();
    }
}

async function installWithHomebrew(): Promise<void> {
    if (!commandExists('brew')) {
        console.log(chalk.yellow('Homebrew was not found.'));
        const { installBrew } = await inquirer.prompt<{ installBrew: boolean }>([{
            type: 'confirm',
            name: 'installBrew',
            message: 'Install Homebrew now?',
            default: false,
        }]);

        if (!installBrew) {
            console.log(chalk.gray(getInstallInstructions()));
            return;
        }

        execSync('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', { stdio: 'inherit' });
    }

    console.log(chalk.blue('Installing OpenResty via Homebrew...'));
    console.log(chalk.gray('This can take several minutes because OpenSSL/LuaJIT dependencies may build locally.'));
    execSync('brew install openresty/brew/openresty', { stdio: 'inherit' });
    await postInstallCheck();
}

async function installWithApt(): Promise<void> {
    if (!commandExists('apt')) {
        console.log(chalk.yellow('apt was not found on this Linux system.'));
        console.log(chalk.gray(getInstallInstructions()));
        return;
    }

    await handlePermission(
        'install OpenResty packages with apt',
        `sh -c 'apt update && apt install -y openresty luarocks && luarocks install lsqlite3'`,
        `Run manually:\nsudo apt update\nsudo apt install -y openresty luarocks\nsudo luarocks install lsqlite3\n\nIf openresty is not found, add the official repository first:\n${getInstallInstructions()}`
    );
    await postInstallCheck();
}

async function installFromSource(): Promise<void> {
    const version = '1.27.1.1';
    const tarball = `openresty-${version}.tar.gz`;
    const downloadUrl = `https://openresty.org/download/${tarball}`;
    const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-openresty-'));
    const tarballPath = path.join(buildRoot, tarball);
    const sourceDir = path.join(buildRoot, `openresty-${version}`);

    console.log(chalk.blue(`Downloading OpenResty ${version}...`));
    execSync(`curl -fSL "${downloadUrl}" -o "${tarballPath}"`, { stdio: 'inherit' });
    execSync(`tar -xzf "${tarballPath}"`, { cwd: buildRoot, stdio: 'inherit' });

    console.log(chalk.blue('Configuring OpenResty...'));
    execSync('./configure -j2', { cwd: sourceDir, stdio: 'inherit' });
    console.log(chalk.blue('Compiling OpenResty...'));
    execSync('make -j2', { cwd: sourceDir, stdio: 'inherit' });

    await handlePermission(
        'install OpenResty from compiled source',
        `sh -c 'cd "${sourceDir}" && make install'`,
        `Run manually:\ncd "${sourceDir}"\nsudo make install`
    );

    await postInstallCheck();
}

function buildChoices(service: OpenRestyServiceStatus): Array<any> {
    const layout = detectOpenRestyLayout();
    const status = getOpenRestyStatus();
    const choices: Array<any> = [
        { name: 'View full status', value: 'status' },
        { name: service.mode === 'service' ? 'Reload now' : 'Start once / reload now', value: 'start-once' },
        service.serviceActive
            ? { name: 'Repair/reinstall service (auto-start is ON)', value: 'install-service' }
            : { name: 'Install service (auto-start after reboot)', value: 'install-service' },
    ];

    if (service.serviceInstalled || service.serviceActive) {
        choices.push({ name: 'Remove service', value: 'remove-service' });
    }

    choices.push(
        new inquirer.Separator(),
        { name: 'Main Server UI target (dev/static/bundled)', value: 'frontend' },
        { name: 'Local HTTPS / self-signed certificates', value: 'local-https' },
        new inquirer.Separator(),
        { name: status.installed ? `Verify binary (${status.bin})` : 'Verify OpenResty installation', value: 'verify' },
        { name: 'Install/refresh netget_app.conf and Lua handlers', value: 'include-conf' },
        { name: 'Repair/regenerate nginx.conf', value: 'repair-config' }
    );

    if (process.platform === 'darwin') {
        choices.push({ name: 'Install/repair OpenResty with Homebrew', value: 'install-homebrew' });
    } else if (process.platform === 'linux') {
        choices.push({ name: 'Install OpenResty with apt (Ubuntu/Debian)', value: 'install-apt' });
        choices.push({ name: 'Build OpenResty from source', value: 'install-source' });
    } else if (!layout.isSupported) {
        choices.push({ name: 'Show WSL2 setup instructions', value: 'instructions' });
    }

    choices.push(
        { name: 'Show platform install instructions', value: 'instructions' },
        new inquirer.Separator(),
        { name: 'Back', value: 'back' }
    );

    return choices;
}

function modeLabel(service: OpenRestyServiceStatus): string {
    if (service.mode === 'service') return chalk.green('SERVICE ON');
    if (service.mode === 'manual') return chalk.yellow('MANUAL RUN');
    if (service.mode === 'stopped') return chalk.red('STOPPED');
    if (service.mode === 'unsupported') return chalk.yellow('UNSUPPORTED');
    return chalk.gray('UNKNOWN');
}

function modeMeaning(service: OpenRestyServiceStatus): string {
    if (service.mode === 'service') return 'auto-starts after reboot';
    if (service.mode === 'manual') return 'running now, but will stop after reboot';
    if (service.mode === 'stopped') return 'not listening';
    if (service.mode === 'unsupported') return 'use WSL2 on Windows';
    return 'state could not be resolved';
}

function portSummary(service: OpenRestyServiceStatus): string {
    const http = service.httpListening ? chalk.green('80') : chalk.gray('80 off');
    const https = service.httpsListening ? chalk.green('443') : chalk.gray('443 off');
    return `${http}/${https}`;
}

function printOpenRestyHeader(service: OpenRestyServiceStatus, message?: string): void {
    console.log(chalk.bold(BREADCRUMB));
    console.log(`OpenResty: ${modeLabel(service)} ${chalk.gray(`(${modeMeaning(service)})`)} · ports ${portSummary(service)}`);
    if (service.serviceInstalled && !service.serviceActive) {
        console.log(chalk.yellow('Service is installed, but not active.'));
    }
    if (message) console.log(`\n${message}`);
    console.log('');
}

function printOpenRestyFullStatus(service: OpenRestyServiceStatus): void {
    const layout = detectOpenRestyLayout();
    const status = getOpenRestyStatus();

    console.log(chalk.bold(BREADCRUMB));
    console.log(chalk.cyan('\nOpenResty'));
    console.log(`  platform: ${process.platform} ${os.arch()}`);
    console.log(`  binary: ${status.bin ? chalk.green(status.bin) : chalk.yellow('not found')}`);
    if (status.version) console.log(`  version: ${chalk.gray(status.version)}`);
    console.log(`  layout: ${layout.isSupported ? chalk.gray(layout.layoutKey) : chalk.yellow('unsupported')}`);
    if (layout.isSupported) console.log(`  nginx.conf: ${layout.configFilePath}`);

    console.log(chalk.cyan('\nOpenResty Runtime'));
    console.log(`  mode: ${modeLabel(service)} ${chalk.gray(`- ${modeMeaning(service)}`)}`);
    console.log(`  binary: ${service.bin ? chalk.green(service.bin) : chalk.yellow('not found')}`);
    console.log(`  service: ${service.serviceName}`);
    console.log(`  installed: ${service.serviceInstalled ? chalk.green('yes') : chalk.yellow('no')}`);
    console.log(`  active: ${service.serviceActive ? chalk.green('yes') : chalk.yellow('no')}`);
    console.log(`  port 80: ${service.httpListening ? chalk.green('listening') : chalk.yellow('closed')}`);
    console.log(`  port 443: ${service.httpsListening ? chalk.green('listening') : chalk.yellow('closed')}`);
    console.log(`  detail: ${chalk.gray(service.detail)}\n`);
}

async function pause(message = 'Press Enter to return to OpenResty menu.'): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: 'continue', message }]);
}

/**
 * Provides platform-aware OpenResty setup and repair options.
 * @memberof module:NetGetX.OpenResty
 */
export default async function openRestyInstallationOptions(): Promise<void> {
    let lastMessage = '';

    while (true) {
        const layout = detectOpenRestyLayout();
        const service = await getOpenRestyServiceStatus();

        console.clear();
        printOpenRestyHeader(service, lastMessage);
        lastMessage = '';

        const answers: InstallAnswers = await inquirer.prompt([{
            type: 'list',
            name: 'choice',
            message: 'OpenResty - choose an action:',
            choices: buildChoices(service)
        }]);

        try {
            switch (answers.choice) {
                case 'verify':
                    console.clear();
                    printOpenRestyHeader(await getOpenRestyServiceStatus());
                    await verifyOpenRestyInstallation();
                    await pause();
                    break;
                case 'install-homebrew':
                    console.clear();
                    await installWithHomebrew();
                    lastMessage = chalk.green('OpenResty Homebrew install/repair finished.');
                    break;
                case 'install-apt':
                    console.clear();
                    await installWithApt();
                    lastMessage = chalk.green('OpenResty apt install finished.');
                    break;
                case 'install-source':
                    console.clear();
                    await installFromSource();
                    lastMessage = chalk.green('OpenResty source install finished.');
                    break;
                case 'include-conf':
                    console.clear();
                    await includeNetgetAppConf();
                    lastMessage = chalk.green('OpenResty app config refreshed.');
                    break;
                case 'repair-config':
                    console.clear();
                    if (!layout.isSupported) {
                        lastMessage = chalk.yellow(layout.installNote || 'This platform is not supported.');
                    } else if (fs.existsSync(layout.configFilePath)) {
                        await setNginxConfigFile();
                        lastMessage = chalk.green('nginx.conf checked.');
                    } else {
                        await ensureNginxConfigFile();
                        lastMessage = chalk.green('nginx.conf created.');
                    }
                    break;
                case 'instructions':
                    console.clear();
                    printOpenRestyHeader(await getOpenRestyServiceStatus());
                    console.log(chalk.gray(getInstallInstructions()));
                    await pause();
                    break;
                case 'status':
                    console.clear();
                    printOpenRestyFullStatus(await getOpenRestyServiceStatus());
                    await pause();
                    break;
                case 'start-once':
                    if (await startOpenRestyOnce(true)) lastMessage = chalk.green('OpenResty started/reloaded. It is still manual unless the service is installed.');
                    else lastMessage = chalk.yellow('OpenResty start/reload command did not finish successfully.');
                    break;
                case 'install-service':
                    if (await installOpenRestyService()) lastMessage = chalk.green('Service ON: OpenResty will auto-start after reboot.');
                    else lastMessage = chalk.yellow('OpenResty service install did not finish successfully.');
                    break;
                case 'remove-service':
                    if (await removeOpenRestyService()) lastMessage = chalk.green('Service removed. OpenResty may still be running manually until stopped/reloaded.');
                    else lastMessage = chalk.yellow('OpenResty service removal did not finish successfully.');
                    break;
                case 'frontend':
                    await mainServerFrontendMenu();
                    break;
                case 'local-https': {
                    const { default: localHttpsMenu } = await import('../Domains/SSL/selfSigned/localHttps.cli.ts');
                    await localHttpsMenu();
                    break;
                }
                case 'back':
                    return;
                default:
                    lastMessage = chalk.red('Invalid choice.');
            }
        } catch (error: any) {
            lastMessage = chalk.red(`OpenResty action failed: ${error.message}`);
        }
    }
}
