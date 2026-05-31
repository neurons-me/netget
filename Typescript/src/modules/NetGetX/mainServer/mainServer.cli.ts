import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveXConfig } from '../config/xConfig.ts';
import type { XStateData } from '../xState.ts';
import { getLocalIP } from '../../utils/ipUtils.ts';

type MainServerNameAction = 'edit' | 'clear' | 'back';

function normalizeIp(value: unknown): string {
    return String(value || '').trim();
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

function getExposure(x: XStateData): {
    localIP: string;
    publicIP: string;
    directPublic: boolean;
    applies: boolean;
    label: string;
    help: string;
} {
    const localIP = normalizeIp(x.localIP) || getLocalIP() || '';
    const publicIP = normalizeIp(x.publicIP);
    const directPublic = !!localIP && !!publicIP && localIP === publicIP && !isPrivateIPv4(localIP);
    const applies = directPublic;

    return {
        localIP,
        publicIP,
        directPublic,
        applies,
        label: applies ? 'public domain applies' : 'local/NAT mode - public domain does not apply yet',
        help: applies
            ? 'Use a real domain whose DNS A record points to this server public IP.'
            : 'Use Domains & Certificates for real domains later. Here, leave it empty or use a local label only.',
    };
}

function looksLikeDomain(value: string): boolean {
    return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function looksLikeLocalLabel(value: string): boolean {
    return /^[a-z0-9][a-z0-9-]{0,62}$/i.test(value);
}

function printHeader(x: XStateData, message?: string): void {
    const exposure = getExposure(x);
    const currentName = String(x.mainServerName || '').trim();

    console.log(chalk.bold('📍 .Get Local > Main Server > Settings > Public domain'));
    console.log(`Current value: ${currentName ? chalk.green(currentName) : chalk.yellow('not set')}`);
    console.log(`Network mode: ${exposure.applies ? chalk.green(exposure.label) : chalk.yellow(exposure.label)}`);
    console.log(`Local IP: ${exposure.localIP || chalk.gray('not detected')}  Public IP: ${exposure.publicIP || chalk.gray('not detected')}`);
    console.log(chalk.gray(exposure.help));

    if (!exposure.applies) {
        console.log(chalk.gray('Meaning now: this value is only a local label; it will not create DNS or public access.'));
    }

    if (message) console.log(`\n${message}`);
    console.log('');
}

/**
 * Menu for managing the Main Server public domain/local label.
 * @memberof module:NetGetX
 */
async function mainServerMenu(x: XStateData): Promise<void> {
    let lastMessage = '';

    while (true) {
        console.clear();
        printHeader(x, lastMessage);
        lastMessage = '';

        const exposure = getExposure(x);
        const { action } = await inquirer.prompt<{ action: MainServerNameAction }>([
            {
                type: 'list',
                name: 'action',
                message: 'Public domain - choose an action:',
                choices: [
                    { name: exposure.applies ? 'Set public domain' : 'Set local label', value: 'edit' },
                    { name: 'Clear value', value: 'clear' },
                    new inquirer.Separator(),
                    { name: 'Back to Settings', value: 'back' },
                ],
            },
        ]);

        if (action === 'back') return;

        if (action === 'clear') {
            await saveXConfig({ mainServerName: '' });
            x.mainServerName = '';
            lastMessage = chalk.green('Public domain/local label cleared.');
            continue;
        }

        const { newMainServer } = await inquirer.prompt<{ newMainServer: string }>([
            {
                type: 'input',
                name: 'newMainServer',
                message: exposure.applies ? 'Enter the public domain for this server:' : 'Enter a local label for this gateway:',
                default: x.mainServerName || '',
                validate: (input: string) => {
                    const clean = input.trim();
                    if (!clean) return exposure.applies ? 'Domain cannot be empty on a public server.' : true;
                    if (exposure.applies) {
                        return looksLikeDomain(clean) ? true : 'Use a real domain, e.g. netget.site or main.netget.site.';
                    }
                    return looksLikeLocalLabel(clean) || looksLikeDomain(clean)
                        ? true
                        : 'Use a simple label like home-lab or a real domain.';
                },
            },
        ]);

        try {
            const cleanName = newMainServer.trim();
            await saveXConfig({ mainServerName: cleanName });
            x.mainServerName = cleanName;
            lastMessage = exposure.applies
                ? chalk.green(`Public domain set to: ${cleanName}`)
                : chalk.green(cleanName ? `Local label set to: ${cleanName}` : 'Left unset for local/NAT mode.');
        } catch (error: any) {
            lastMessage = chalk.red(`Error updating value: ${error.message}`);
        }
    }
}

export default mainServerMenu;
