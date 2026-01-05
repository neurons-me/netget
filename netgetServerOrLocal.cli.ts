import { promises as fsPromises, constants } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import NetGetMainMenu from './src/modules/netget_MainMenu.cli.ts';
import { getNetgetDataDir } from './src/utils/netgetPaths.js';

interface Server {
    id: number;
    name: string;
    host: string;
    port: number;
    description?: string;
}
const DATA_DIR = getNetgetDataDir();
const SERVERS_FILE = join(DATA_DIR, 'servers.json');
console.log(chalk.gray('Data directory:', DATA_DIR));

async function ensureDataFile(): Promise<void> {
    try {
        await fsPromises.access(SERVERS_FILE, constants.F_OK);
    } catch {
        await fsPromises.writeFile(SERVERS_FILE, '[]', 'utf8');
    }
}

async function readServers(): Promise<Server[]> {
    try {
        const raw = await fsPromises.readFile(SERVERS_FILE, 'utf8');
        return (JSON.parse(raw || '[]') as Server[]) || [];
    } catch {
        return [];
    }
}

async function writeServers(list: Server[]): Promise<void> {
    await fsPromises.writeFile(SERVERS_FILE, JSON.stringify(list, null, 2), 'utf8');
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

type NetworkChoice = 'add' | 'list' | 'back';

async function networkMenu(): Promise<void> {
    while (true) {
        const { networkChoice } = await inquirer.prompt<{ networkChoice: NetworkChoice }>([
            {
                name: 'networkChoice',
                type: 'list',
                message: 'Network - choose an option:',
                choices: [
                    { name: 'Add Server', value: 'add' },
                    { name: 'List Servers', value: 'list' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (networkChoice === 'add') {
            await addServerFlow();
        } else if (networkChoice === 'list') {
            await listServersFlow();
        } else {
            return;
        }
    }
}

// Se utiliza el NetGetMainMenu real desde src/modules/netget_MainMenu.cli.ts

export async function mainMenu(): Promise<void> {
    await ensureDataFile();

    while (true) {
        const { entry } = await inquirer.prompt<{ entry: 'network' | 'local' | 'exit' }>([
            {
                name: 'entry',
                type: 'list',
                message: 'Select an option:',
                choices: [
                    { name: 'Network', value: 'network' },
                    { name: 'Local', value: 'local' },
                    { name: 'Exit', value: 'exit' }
                ]
            }
        ]);

        if (entry === 'network') {
            await networkMenu();
        } else if (entry === 'local') {
            await NetGetMainMenu();
        } else {
            console.log('Going out...');
            process.exit(0);
        }
    }
}