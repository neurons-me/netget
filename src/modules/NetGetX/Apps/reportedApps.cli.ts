import inquirer from 'inquirer';
import chalk from 'chalk';
import { readReportedApps } from '../../../runtime/appRegistry.ts';
import { listPortLeases } from '../../../runtime/portLeases.ts';

type AppsChoice = 'refresh' | 'reports' | 'leases' | 'back';

type ReportedApp = ReturnType<typeof readReportedApps>[number];
type LeaseRow = Awaited<ReturnType<typeof listPortLeases>>[number];

function ageLabel(ms?: number): string {
    if (!ms) return 'unknown';
    const age = Math.max(0, Date.now() - ms);
    if (age < 1000) return 'now';
    if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
    return `${Math.round(age / 60_000)}m ago`;
}

function leaseStatus(lease?: LeaseRow): string {
    if (!lease) return '';
    if (lease.fresh && lease.pidAlive) return lease.status;
    if (lease.pidAlive) return 'stale';
    return 'dead';
}

function appStatus(app?: ReportedApp): string {
    if (!app) return '';
    return app.alive ? 'alive' : 'stale';
}

async function printLocalAppsOverview(): Promise<void> {
    const apps = readReportedApps();
    const leases = await listPortLeases();
    const names = new Set<string>();

    for (const app of apps) names.add(app.name);
    for (const lease of leases) names.add(lease.name);

    console.log(chalk.bold('📍 .Get Local > Main Server > Local Apps'));
    console.log(chalk.gray('Semantic app reports + operational port leases in one place.'));
    console.log(chalk.gray('Apps declare identity; leases prove port ownership.\n'));

    if (names.size === 0) {
        console.log(chalk.yellow('No local apps yet.'));
        console.log(chalk.gray('Start one with: const ng = await netget({ name: "api" })'));
        return;
    }

    const rows = [...names].sort().map((name) => {
        const app = apps.find((candidate) => candidate.name === name);
        const lease = leases.find((candidate) => candidate.name === name);
        const port = app?.port || lease?.port || '';
        const routeTarget = name ? `app:${name}` : '';

        return {
            App: name,
            Port: port,
            AppReport: appStatus(app) || 'none',
            Lease: leaseStatus(lease) || 'none',
            Mode: app?.mode || lease?.mode || '',
            Target: routeTarget,
            Seen: app ? ageLabel(app.lastSeenMs) : '',
            PID: app?.pid || lease?.pid || '',
        };
    });

    console.table(rows);
}

function printReportedApps(): void {
    const apps = readReportedApps();
    console.log(chalk.bold('📍 .Get Local > Main Server > Local Apps > App Reports'));
    console.log(chalk.gray('Heartbeat reports written by apps that called netget().\n'));

    if (apps.length === 0) {
        console.log(chalk.yellow('No app reports.'));
        return;
    }

    console.table(apps.map((app) => ({
        Name: app.name,
        Port: app.port || '',
        Status: appStatus(app),
        Mode: app.mode || '',
        URL: app.url || '',
        PID: app.pid,
        Seen: ageLabel(app.lastSeenMs),
        Lease: app.leaseId || '',
    })));
}

async function printPortLeases(): Promise<void> {
    const leases = await listPortLeases();
    console.log(chalk.bold('📍 .Get Local > Main Server > Local Apps > Port Leases'));
    console.log(chalk.gray('Operational truth for local ports. Locks guarantee ownership; JSON describes it.\n'));

    if (leases.length === 0) {
        console.log(chalk.yellow('No port leases.'));
        return;
    }

    console.table(leases.map((lease) => ({
        Name: lease.name,
        Port: lease.port,
        Mode: lease.mode,
        Status: leaseStatus(lease),
        PID: lease.pid,
        Fresh: lease.fresh ? 'yes' : 'no',
        Lock: lease.lockPath,
    })));
}

async function pause(): Promise<void> {
    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to continue.' }]);
}

export default async function reportedAppsMenu(): Promise<void> {
    while (true) {
        console.clear();
        await printLocalAppsOverview();
        console.log('');

        const { choice } = await inquirer.prompt<{ choice: AppsChoice }>([{
            type: 'list',
            name: 'choice',
            message: 'Local Apps',
            choices: [
                { name: 'Refresh overview', value: 'refresh' },
                { name: 'View app reports', value: 'reports' },
                { name: 'View port leases', value: 'leases' },
                new inquirer.Separator(),
                { name: 'Back', value: 'back' },
            ],
        }]);

        if (choice === 'back') return;

        if (choice === 'reports') {
            console.clear();
            printReportedApps();
            await pause();
        }

        if (choice === 'leases') {
            console.clear();
            await printPortLeases();
            await pause();
        }
    }
}

export { printLocalAppsOverview, printPortLeases, printReportedApps };
