import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { generateDomainMap } from '../../../runtime/domainMap.ts';
import { readReportedApps } from '../../../runtime/appRegistry.ts';
import { getDomains, updateDomainRoute, type DomainRecord } from '../../../sqlite/utils_sqlite3.ts';
import { isReservedLocalDomain } from './reservedDomains.ts';

type RoutingChoice = 'refresh' | 'back' | string;
type RouteAction = 'attach-app' | 'forward-port' | 'static' | 'clear' | 'refresh' | 'back';

function displayTarget(target?: string): string {
    if (!target) return '';
    if (target.startsWith('app:')) return `${target} (identity route)`;
    return target;
}

function routeLabel(domain: DomainRecord): string {
    const host = domain.domain;
    if (domain.type && domain.target) {
        return `${host}  ${chalk.gray(`${domain.type} -> ${displayTarget(domain.target)}`)}`;
    }
    return `${host}  ${chalk.yellow('(inactive)')}`;
}

function normalizeServerTarget(input: string): string {
    const raw = input.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (/^\d+$/.test(raw)) return `127.0.0.1:${raw}`;
    return raw;
}

function validateServerTarget(input: string): true | string {
    const target = normalizeServerTarget(input);
    if (/^127\.0\.0\.1:\d{1,5}$/.test(target)) return true;
    if (/^localhost:\d{1,5}$/i.test(target)) return true;
    if (/^[a-z0-9.-]+:\d{1,5}$/i.test(target)) return true;
    return 'Use a port like 5173, or host:port like 127.0.0.1:5173.';
}

function validateStaticRoot(input: string): true | string {
    const raw = input.trim();
    if (!raw) return 'Static folder is required.';
    if (!path.isAbsolute(raw)) return 'Use an absolute path.';
    if (!fs.existsSync(raw)) return 'Path does not exist.';
    return true;
}

function printRoutes(domains: DomainRecord[]): void {
    const active = domains.filter((domain) => domain.type && domain.target);
    if (active.length === 0) {
        console.log(chalk.yellow('No active routes.'));
        return;
    }

    console.table(active.map((domain) => ({
        Hostname: domain.domain,
        Type: domain.type,
        Target: displayTarget(domain.target),
    })));
}

async function manageRoute(domain: DomainRecord): Promise<void> {
    let selected = domain;

    while (true) {
        console.clear();
        console.log(chalk.bold('📍 .Get Local > Main Server > Routing table'));
        console.log(`Domain: ${chalk.green(selected.domain)}`);
        console.log(`Current route: ${selected.type && selected.target ? chalk.green(`${selected.type} -> ${displayTarget(selected.target)}`) : chalk.yellow('inactive')}`);
        console.log(chalk.gray('A route becomes active only when both type and target are set.\n'));

        const { action } = await inquirer.prompt<{ action: RouteAction }>([{
            type: 'list',
            name: 'action',
            message: 'Route action:',
            choices: [
                { name: 'Attach reported local app', value: 'attach-app' },
                { name: 'Forward to local app port', value: 'forward-port' },
                { name: 'Serve static folder', value: 'static' },
                { name: 'Clear route / make inactive', value: 'clear' },
                new inquirer.Separator(),
                { name: 'Regenerate domain-map.json', value: 'refresh' },
                { name: 'Back to Routing table', value: 'back' },
            ],
        }]);

        if (action === 'back') return;

        if (action === 'attach-app') {
            const apps = readReportedApps().filter((app) => app.alive && app.port);
            if (apps.length === 0) {
                console.log(chalk.yellow('No live reported apps found. Start an app that calls netget({ name, port }) first.'));
                await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue.' }]);
                continue;
            }

            const { appId } = await inquirer.prompt<{ appId: string }>([{
                type: 'list',
                name: 'appId',
                message: 'Select reported app:',
                choices: [
                    ...apps.map((app) => ({
                        name: `${app.name}  ${chalk.gray(app.url || `${app.host}:${app.port}`)}`,
                        value: app.id,
                    })),
                    new inquirer.Separator(),
                    { name: 'Back', value: 'back' },
                ],
            }]);
            if (appId === 'back') continue;

            const app = apps.find((candidate) => candidate.id === appId);
            if (!app || !app.port) continue;

            const target = `app:${app.name}`;
            await updateDomainRoute(selected.domain, 'server', target);
            selected = { ...selected, type: 'server', target };
            continue;
        }

        if (action === 'forward-port') {
            const { target } = await inquirer.prompt<{ target: string }>([{
                type: 'input',
                name: 'target',
                message: 'Target port or host:port:',
                default: selected.target && selected.type === 'server' ? selected.target : '127.0.0.1:5173',
                validate: validateServerTarget,
                filter: normalizeServerTarget,
            }]);
            await updateDomainRoute(selected.domain, 'server', target);
            selected = { ...selected, type: 'server', target };
            continue;
        }

        if (action === 'static') {
            const { root } = await inquirer.prompt<{ root: string }>([{
                type: 'input',
                name: 'root',
                message: 'Absolute path to static folder:',
                default: selected.target && selected.type === 'static' ? selected.target : '',
                validate: validateStaticRoot,
                filter: (value: string) => value.trim(),
            }]);
            await updateDomainRoute(selected.domain, 'static', root);
            selected = { ...selected, type: 'static', target: root };
            continue;
        }

        if (action === 'clear') {
            await updateDomainRoute(selected.domain, null, null);
            selected = { ...selected, type: undefined, target: undefined };
            continue;
        }

        if (action === 'refresh') {
            const mapPath = await generateDomainMap();
            console.log(chalk.green(`Domain map written: ${mapPath}`));
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue.' }]);
        }
    }
}

export default async function routingTableMenu(): Promise<void> {
    while (true) {
        console.clear();
        console.log(chalk.bold('📍 .Get Local > Main Server > Routing table'));
        console.log(chalk.gray('Active routes are projected into domain-map.json and served by OpenResty.'));
        console.log(chalk.gray('Domains must be registered first in Domains & Certificates.\n'));

        const domains = (await getDomains())
            .filter((domain) => domain.domain && !isReservedLocalDomain(domain.domain))
            .sort((a, b) => a.domain.localeCompare(b.domain));

        printRoutes(domains);
        console.log('');

        const choices: Array<any> = [
            ...(domains.length > 0 ? domains.map((domain) => ({ name: routeLabel(domain), value: domain.domain })) : []),
            ...(domains.length > 0 ? [new inquirer.Separator()] : []),
            { name: 'Regenerate domain-map.json', value: 'refresh' },
            { name: 'Back', value: 'back' },
        ];

        const { choice } = await inquirer.prompt<{ choice: RoutingChoice }>([{
            type: 'list',
            name: 'choice',
            message: domains.length > 0 ? 'Select a registered domain:' : 'No registered domains yet:',
            choices,
        }]);

        if (choice === 'back') return;

        if (choice === 'refresh') {
            const mapPath = await generateDomainMap();
            console.log(chalk.green(`Domain map written: ${mapPath}`));
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue.' }]);
            continue;
        }

        const selected = domains.find((domain) => domain.domain === choice);
        if (selected) await manageRoute(selected);
    }
}
