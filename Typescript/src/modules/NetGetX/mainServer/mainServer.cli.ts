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
    // A server is directly publicly reachable if it has a public IP that is
    // not itself a private/loopback/link-local address. On cloud VMs (GCP,
    // AWS, etc.) the local IP is typically a private NAT-internal address
    // (e.g. 10.x.x.x) while the public IP is a separate externally-routable
    // address with 1:1 NAT — they are never equal, but the server is still
    // directly reachable on its public IP.
    const directPublic = !!publicIP && !isPrivateIPv4(publicIP);
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

async function pause(message = 'Press Enter to continue.'): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: 'continue', message }]);
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

    console.log(chalk.bold('📍 .Local Main Server > Settings > Public domain'));
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
            const previous = String(x.mainServerName || '').trim();
            await saveXConfig({ mainServerName: '' });
            x.mainServerName = '';
            await cleanupMainServerDomainRecord(previous);
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
            const previous = String(x.mainServerName || '').trim();
            await saveXConfig({ mainServerName: cleanName });
            x.mainServerName = cleanName;

            if (previous && previous !== cleanName) {
                await cleanupMainServerDomainRecord(previous);
            }
            lastMessage = exposure.applies
                ? chalk.green(`Public domain set to: ${cleanName}`)
                : chalk.green(cleanName ? `Local label set to: ${cleanName}` : 'Left unset for local/NAT mode.');

            // For real public domains, offer to wire up registration + Let's Encrypt + domain-map
            // in one go, so the panel becomes reachable as https://<domain> immediately.
            if (exposure.applies && cleanName) {
                await offerProvisionMainDomain(x, cleanName);
                await pause('Press Enter to continue.');
            }
        } catch (error: any) {
            lastMessage = chalk.red(`Error updating value: ${error.message}`);
        }
    }
}

/**
 * Remove the auto-registered domain-store record for a previous main server
 * domain (owner: 'main-server'). Only ever touches records this flow created
 * itself — never a user's own app domains. Best-effort: regenerates the
 * domain-map afterwards so the stale route stops being served.
 */
async function cleanupMainServerDomainRecord(domain: string): Promise<void> {
    if (!domain) return;
    try {
        const { getDomainByName, deleteDomain } = await import('../../../kernel/domainStore.js');
        const existing = await getDomainByName(domain);
        if (existing && existing.owner === 'main-server') {
            await deleteDomain(domain);
            const { generateDomainMap } = await import('../../../runtime/domainMap.ts');
            await generateDomainMap();
        }
    } catch {
        // best-effort cleanup; not fatal if it fails
    }
}

/**
 * After the operator sets a real public domain as the main server name,
 * offer to do the rest of the "go live" wiring in one step:
 *  - register the domain in the domain store (type: server -> the panel port)
 *  - provision a Let's Encrypt cert via certbot (HTTP-01 webroot)
 *  - regenerate domain-map.json so OpenResty/Lua picks it up immediately
 *
 * This is best-effort: failures are reported but never crash the menu, and the
 * operator can always retry later from Domains & Certificates.
 */
async function offerProvisionMainDomain(x: XStateData, domain: string): Promise<void> {
    const { confirmGoLive } = await inquirer.prompt<{ confirmGoLive: boolean }>([
        {
            type: 'confirm',
            name: 'confirmGoLive',
            message: `Register ${domain} and request a Let's Encrypt certificate now? (requires its A record to already point to this server's public IP)`,
            default: true,
        },
    ]);
    if (!confirmGoLive) {
        console.log(chalk.gray('Skipped. You can do this later from Domains & Certificates.'));
        return;
    }

    const { email } = await inquirer.prompt<{ email: string }>([
        {
            type: 'input',
            name: 'email',
            message: "Contact email for Let's Encrypt:",
            default: String((x as any).email || ''),
            validate: (v: string) => v.trim() ? true : 'Required',
        },
    ]);

    try {
        const { getDomainByName, registerDomain } = await import('../../../kernel/domainStore.js');
        const existing = await getDomainByName(domain);
        const port = String((x as any).xMainOutPutPort || 3432);

        if (!existing) {
            await registerDomain(domain, domain, email, 'letsencrypt', '', '', port, 'server', '', 'main-server');
            console.log(chalk.green(`Registered ${domain} -> 127.0.0.1:${port} (server).`));
        } else {
            console.log(chalk.gray(`${domain} is already registered — skipping registration.`));
        }

        const { provisionCert } = await import('../Domains/SSL/Certbot/certbotProvision.ts');
        const result = await provisionCert(domain, email);
        if (result.ok) {
            console.log(chalk.green(`✓ ${result.message}`));
        } else {
            console.log(chalk.yellow(`✗ ${result.message}`));
            console.log(chalk.gray('You can retry this later from Domains & Certificates -> Provision SSL.'));
            return;
        }

        const { generateDomainMap } = await import('../../../runtime/domainMap.ts');
        await generateDomainMap();
        const { default: includeNetgetAppConf } = await import('../OpenResty/includeNetgetAppConf.ts');
        await includeNetgetAppConf();
        console.log(chalk.green(`✓ ${domain} is now the main server. Try: https://${domain}`));
    } catch (error: any) {
        console.log(chalk.yellow(`Could not finish go-live wiring: ${error.message}`));
        console.log(chalk.gray('You can configure this later from Domains & Certificates.'));
    }
}

export default mainServerMenu;
