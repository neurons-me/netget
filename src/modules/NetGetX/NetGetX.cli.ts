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

interface MenuAnswers {
    option: string;
}

type MainServerChoice =
    | 'domains'
    | 'apps'
    | 'routing'
    | 'open-http'
    | 'open-https'
    | 'openresty'
    | 'settings'
    | 'snapshot'
    | 'network-ips'
    | 'back'
    | 'exit';

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
    const localIP = String(x?.localIP || '').trim();
    const publicIP = String(x?.publicIP || '').trim();
    return !!localIP && !!publicIP && localIP === publicIP && !isPrivateIPv4(localIP);
}

function printMainServerHeader(x: XStateData, message?: string): void {
    const domainLabel = publicDomainApplies(x) ? 'publicDomain' : 'localLabel';

    console.log(chalk.bold('📍 .Get Local > Main Server'));
    console.log(chalk.bold('Main Server X:'));
    console.log(`
     ██╗  ██╗
     ╚██╗██╔╝ .publicIP: ${chalk.green(x?.publicIP || 'Not Set')}
      ╚███╔╝  .localIP: ${chalk.green(x?.localIP || 'Not Set')}
      ██╔██╗  .${domainLabel}: ${chalk.green('' + (x?.mainServerName || 'Not Set'))}
     ██╔╝ ██╗
     ╚═╝  ╚═╝ `);

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

/**
 * NetGetX_CLI
 * @memberof module:NetGetX 
 */
export default async function NetGetX_CLI(x?: XStateData): Promise<void> {
    if (!x) {
        x = await loadOrCreateXConfig() as XStateData;
    }
    let lastMessage = '';

    while (true) {
        console.clear();
        printMainServerHeader(x, lastMessage);
        lastMessage = '';

        const answers = await inquirer.prompt<MenuAnswers>({
            type: 'list',
            name: 'option',
            message: 'Main Server',
            choices: [
                { name: 'Domains & Certificates', value: 'domains' },
                { name: 'Local Apps', value: 'apps' },
                { name: 'Routing table', value: 'routing' },
                { name: 'Open http://local.netget', value: 'open-http' },
                { name: 'Open https://local.netget', value: 'open-https' },
                { name: 'OpenResty', value: 'openresty' },
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
            case 'open-https':
                await open('https://local.netget');
                lastMessage = chalk.green('Opened https://local.netget');
                break;
            case 'openresty':
                await openRestyInstallationOptions();
                break;
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
                console.log(chalk.bold('📍 .Get Local > Main Server > Network IPs'));
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
