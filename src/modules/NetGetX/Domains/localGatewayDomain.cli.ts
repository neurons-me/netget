import inquirer from 'inquirer';
import chalk from 'chalk';
import open from 'open';
import localHttpsMenu from './SSL/selfSigned/localHttps.cli.ts';
import mainServerFrontendMenu from '../OpenResty/mainServerFrontend.cli.ts';
import { printLocalSnapshot, printNetworkIPs } from '../../../utils/localEnvironment.cli.ts';
export { isReservedLocalDomain, RESERVED_LOCAL_DOMAINS } from './reservedDomains.ts';

type LocalGatewayChoice =
    | 'open-http'
    | 'open-https'
    | 'frontend'
    | 'https'
    | 'snapshot'
    | 'network-ips'
    | 'back';

async function pause(message = 'Press Enter to return to Local gateway.'): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: 'continue', message }]);
}

function printLocalGatewayHeader(message = ''): void {
    console.clear();
    console.log(chalk.bold('📍 .Get Local > Main Server > Local gateway'));
    console.log(chalk.cyan('local.netget'));
    console.log(chalk.gray('Reserved hostname for this machine. It points to the Main Server UI through local OpenResty.'));
    console.log(chalk.gray('It is not a public routed domain, so subdomains, domain deletion, and public SSL do not apply here.'));
    if (message) console.log(`\n${message}`);
    console.log('');
}

export default async function localGatewayDomainMenu(): Promise<void> {
    let lastMessage = '';

    while (true) {
        printLocalGatewayHeader(lastMessage);
        lastMessage = '';

        const { choice } = await inquirer.prompt<{ choice: LocalGatewayChoice }>([{
            type: 'list',
            name: 'choice',
            message: 'Local gateway',
            choices: [
                { name: 'Open http://local.netget', value: 'open-http' },
                { name: 'Open https://local.netget', value: 'open-https' },
                new inquirer.Separator(),
                { name: 'Main Server UI target (dev/static/bundled)', value: 'frontend' },
                { name: 'Local HTTPS / self-signed certificates', value: 'https' },
                new inquirer.Separator(),
                { name: 'View local environment snapshot', value: 'snapshot' },
                { name: 'Check network IPs (LAN / WAN)', value: 'network-ips' },
                new inquirer.Separator(),
                { name: 'Back to routed domains', value: 'back' },
            ],
        }]);

        if (choice === 'back') return;

        if (choice === 'open-http') {
            await open('http://local.netget');
            lastMessage = chalk.green('Opened http://local.netget');
            continue;
        }

        if (choice === 'open-https') {
            await open('https://local.netget');
            lastMessage = chalk.green('Opened https://local.netget');
            continue;
        }

        if (choice === 'frontend') {
            await mainServerFrontendMenu();
            continue;
        }

        if (choice === 'https') {
            await localHttpsMenu();
            continue;
        }

        if (choice === 'snapshot') {
            console.clear();
            await printLocalSnapshot();
            await pause();
            continue;
        }

        if (choice === 'network-ips') {
            console.clear();
            console.log(chalk.bold('📍 .Get Local > Main Server > Local gateway > Network IPs'));
            await printNetworkIPs();
            await pause();
        }
    }
}
