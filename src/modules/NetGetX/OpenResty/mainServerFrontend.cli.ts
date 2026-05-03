import fs from 'fs';
import inquirer from 'inquirer';
import chalk from 'chalk';
import includeNetgetAppConf from './includeNetgetAppConf.ts';
import {
    copyPackageMainServerUiToLocalDist,
    getActiveStaticRoot,
    hasIndexHtml,
    resolveMainServerFrontendConfig,
    saveMainServerFrontendConfig,
    type MainServerFrontendMode,
} from './mainServerFrontend.ts';

type FrontendChoice =
    | 'status'
    | 'dev'
    | 'package-dist'
    | 'local-dist'
    | 'custom-static'
    | 'copy-bundled'
    | 'refresh-conf'
    | 'back';

function printFrontendStatus(): void {
    const frontend = resolveMainServerFrontendConfig();
    const activeStaticRoot = getActiveStaticRoot(frontend);

    console.log(chalk.cyan('\nMain Server UI'));
    console.log(`  mode: ${chalk.green(frontend.mode)}`);
    console.log(`  dev URL: ${frontend.devUrl}`);
    console.log(`  package dist: ${fs.existsSync(frontend.packageDistRoot) ? chalk.green(frontend.packageDistRoot) : chalk.yellow(`${frontend.packageDistRoot} (missing)`)}`);
    console.log(`  local dist: ${fs.existsSync(frontend.localDistRoot) ? chalk.green(frontend.localDistRoot) : chalk.yellow(`${frontend.localDistRoot} (missing)`)}`);

    if (frontend.mode === 'dev') {
        console.log(`  active target: ${chalk.green(frontend.devUrl)} ${chalk.gray('(proxy + HMR websocket)')}`);
    } else {
        console.log(`  active root: ${hasIndexHtml(activeStaticRoot) ? chalk.green(activeStaticRoot) : chalk.yellow(`${activeStaticRoot} (missing index.html)`)}`);
    }
    console.log('');
}

async function promptReloadConf(): Promise<void> {
    const { refresh } = await inquirer.prompt<{ refresh: boolean }>([{
        type: 'confirm',
        name: 'refresh',
        message: 'Refresh netget_app.conf now so OpenResty uses this frontend target?',
        default: true,
    }]);
    if (refresh) await includeNetgetAppConf();
}

async function setMode(mode: MainServerFrontendMode, extra: { devUrl?: string; staticRoot?: string } = {}): Promise<void> {
    const next = await saveMainServerFrontendConfig({ mode, ...extra });
    console.log(chalk.green(`Main Server UI mode set to ${next.mode}.`));
    await promptReloadConf();
}

export default async function mainServerFrontendMenu(): Promise<void> {
    while (true) {
        printFrontendStatus();

        const { choice } = await inquirer.prompt<{ choice: FrontendChoice }>([{
            type: 'list',
            name: 'choice',
            message: 'Main Server UI - choose an action:',
            choices: [
                { name: 'Status', value: 'status' },
                new inquirer.Separator(),
                { name: 'Use Dev React App (proxy http://127.0.0.1:5173 + HMR)', value: 'dev' },
                { name: 'Use package built interface (netget/assets/main-server-ui/dist)', value: 'package-dist' },
                { name: 'Use local bundled copy (~/.get/dist)', value: 'local-dist' },
                { name: 'Use custom built dist folder', value: 'custom-static' },
                new inquirer.Separator(),
                { name: 'Copy package built UI into ~/.get/dist', value: 'copy-bundled' },
                { name: 'Refresh OpenResty app config', value: 'refresh-conf' },
                new inquirer.Separator(),
                { name: 'Back', value: 'back' },
            ],
        }]);

        if (choice === 'back') return;
        if (choice === 'status') continue;

        if (choice === 'dev') {
            const current = resolveMainServerFrontendConfig();
            const { devUrl } = await inquirer.prompt<{ devUrl: string }>([{
                type: 'input',
                name: 'devUrl',
                message: 'React/Vite dev server URL:',
                default: current.devUrl,
                validate: (value) => {
                    try {
                        const parsed = new URL(String(value));
                        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
                            ? true
                            : 'Use http:// or https://';
                    } catch {
                        return 'Enter a valid URL.';
                    }
                },
            }]);
            await setMode('dev', { devUrl });
            continue;
        }

        if (choice === 'package-dist') {
            await setMode('package-dist');
            continue;
        }

        if (choice === 'local-dist') {
            await setMode('local-dist');
            continue;
        }

        if (choice === 'custom-static') {
            const { staticRoot } = await inquirer.prompt<{ staticRoot: string }>([{
                type: 'input',
                name: 'staticRoot',
                message: 'Absolute path to built dist folder:',
                validate: (value) => {
                    const raw = String(value || '').trim();
                    if (!raw) return 'Path is required.';
                    if (!fs.existsSync(raw)) return 'Path does not exist.';
                    if (!hasIndexHtml(raw)) return 'Folder must contain index.html.';
                    return true;
                },
            }]);
            await setMode('package-dist', { staticRoot });
            continue;
        }

        if (choice === 'copy-bundled') {
            try {
                const result = copyPackageMainServerUiToLocalDist();
                console.log(chalk.green(`Copied Main Server UI:\n  from: ${result.from}\n  to:   ${result.to}`));
                await saveMainServerFrontendConfig({ mode: 'local-dist' });
                await promptReloadConf();
            } catch (error: any) {
                console.log(chalk.red(`Could not copy bundled UI: ${error.message}`));
            }
            continue;
        }

        if (choice === 'refresh-conf') {
            await includeNetgetAppConf();
        }
    }
}

export { printFrontendStatus };
