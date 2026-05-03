import { promises as fsPromises, constants } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

interface Server {
    id: number;
    name: string;
    host: string;
    port: number;
    description?: string;
}

async function getServersFile(): Promise<string> {
    const { getNetgetDataDir } = await import('./netgetPaths.js');
    return join(getNetgetDataDir(), 'servers.json');
}

async function ensureDataFile(): Promise<void> {
    const serversFile = await getServersFile();
    try {
        await fsPromises.access(serversFile, constants.F_OK);
    } catch {
        await fsPromises.writeFile(serversFile, '[]', 'utf8');
    }
}

async function readServers(): Promise<Server[]> {
    await ensureDataFile();
    try {
        const raw = await fsPromises.readFile(await getServersFile(), 'utf8');
        return (JSON.parse(raw || '[]') as Server[]) || [];
    } catch {
        return [];
    }
}

async function writeServers(list: Server[]): Promise<void> {
    await ensureDataFile();
    await fsPromises.writeFile(await getServersFile(), JSON.stringify(list, null, 2), 'utf8');
}

type AddServerAnswers = {
    name: string;
    host: string;
    port: string;
    description?: string;
};

async function addServerFlow(): Promise<void> {
    const answers = await inquirer.prompt<AddServerAnswers>([
        { name: 'name', message: 'Server Name:', type: 'input', validate: (v: string) => (v ? true : 'Required') },
        { name: 'host', message: 'Host or IP:', type: 'input', validate: (v: string) => (v ? true : 'Required') },
        { name: 'port', message: 'Port:', type: 'input', default: '22', validate: (v: string) => (/^\d+$/.test(v) ? true : 'Invalid number') },
        { name: 'description', message: 'Description (optional):', type: 'input' }
    ]);

    const servers = await readServers();
    servers.push({
        id: Date.now(),
        name: answers.name,
        host: answers.host,
        port: Number(answers.port),
        description: answers.description || ''
    });
    await writeServers(servers);
    console.log(chalk.green('Server added successfully.\n'));
}

async function listServersFlow(): Promise<void> {
    const servers = await readServers();
    if (!servers.length) {
        console.log(chalk.yellow('No registered servers found.\n'));
        return;
    }
    console.log(chalk.blue('\nRegistered Servers:'));
    servers.forEach((s, i) => {
        console.log(
            `${i + 1}. ${s.name} - ${s.host}:${s.port}${s.description ? ' (' + s.description + ')' : ''}`
        );
    });
    console.log('');
}

type RemoteChoice = 'add' | 'list' | 'back' | 'netget-site';

async function remoteMenu(): Promise<void> {
    await ensureDataFile();

    while (true) {
        const { remoteChoice } = await inquirer.prompt<{ remoteChoice: RemoteChoice }>([
            {
                name: 'remoteChoice',
                type: 'list',
                message: 'Remote - choose an option:',
                choices: [
                    { name: 'Netget Site', value: 'netget-site' },
                    new inquirer.Separator(),
                    { name: 'Add Server', value: 'add' },
                    { name: 'List Servers', value: 'list' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (remoteChoice === 'add') {
            await addServerFlow();
        } else if (remoteChoice === 'list') {
            await listServersFlow();
        } else if (remoteChoice === 'netget-site') {
            //TODO: NetgetSite in DB integration
        } else {
            return;
        }
    }
}

// Se utiliza el NetGetMainMenu real desde src/modules/netget_MainMenu.cli.ts

export async function mainMenu(): Promise<void> {
    while (true) {
        console.clear();
        const { entry } = await inquirer.prompt<{ entry: 'remote' | 'local' | 'ports' | 'exit' }>([
            {
                name: 'entry',
                type: 'list',
                message: 'Select an option:',
                choices: [
                    { name: '🛰  .Get Remote', value: 'remote' },
                    { name: '📍 .Get Local', value: 'local' },
                    new inquirer.Separator(),
                    { name: '🔌  Port Management', value: 'ports' },
                    new inquirer.Separator(),
                    { name: 'Exit', value: 'exit' }
                ]
            }
        ]);

        if (entry === 'remote') {
            await remoteMenu();
        } else if (entry === 'local') {
            const { localMenu } = await import('./localEnvironment.cli.ts');
            await localMenu();
        } else if (entry === 'ports') {
            const { PortManagement_CLI } = await import('../modules/PortManagement/portManagement.cli.ts');
            await PortManagement_CLI();
        } else {
            console.log('Going out...');
            process.exit(0);
        }
    }
}
