// local.netget.cli.ts
import { exec, spawn, ChildProcess } from 'child_process';
import net from 'net';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenvFlow from 'dotenv-flow';

dotenvFlow.config({
  path: process.cwd() + '/local.netget/backend/env',
  pattern: '.env[.node_env]',
  default_node_env: 'development'
});

const BACKEND_PORT: number = parseInt(process.env.LOCAL_BACKEND_PORT || '3000', 10);
const FRONTEND_PORT: number = parseInt(process.env.LOCAL_FRONTEND_PORT || '5173', 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFilePath: string = path.join(__dirname, 'server.log');

// Function to check if a port is available
function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false)); // Port in use
        server.once('listening', () => {
            server.close(() => resolve(true)); // Port is free
        });
        server.listen(port);
    });
}

// Function to kill a process by port
function killProcessOnPort(port: number): Promise<void> {
    return new Promise((resolve) => {
        const cmd = process.platform === 'win32' 
            ? `for /f "tokens=5" %a in ('netstat -ano | findstr :${port}') do taskkill /PID %a /F`
            : `lsof -ti:${port} | xargs kill -9`;

        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error(chalk.red(`Error stopping process on port ${port}: ${stderr}`));
            } else {
                console.log(chalk.green(`Successfully stopped process on port ${port}.`));
            }
            resolve();
        });
    });
}

async function viewLogs(): Promise<void> {
    console.log(chalk.yellow('\n=== Viewing Logs ===\n'));

    const logs = spawn('tail', ['-f', logFilePath]);

    logs.stdout.pipe(process.stdout);
    logs.stderr.pipe(process.stderr);
}

interface MenuAnswers {
    option: string;
}

export default async function LocalNetgetCLI(): Promise<void> {
    console.log(chalk.blue('Welcome to Local NetGet!'));

    let backendProcess: ChildProcess | undefined;
    let frontendProcess: ChildProcess | undefined;

    let exit = false;
    while (!exit) {
        const answers = await inquirer.prompt<MenuAnswers>({
            type: 'list',
            name: 'option',
            message: 'Select an action:',
            choices: [
                '1. Start Local NetGet Server',
                '2. Stop Local NetGet Server',
                '3. View Logs',
                '4. Back',
                '5. Exit'
            ]
        });

        if (answers.option === '4. Back') {
            console.clear();
            return;
        }

        switch (answers.option) {
            case '1. Start Local NetGet Server':
                console.clear();
                console.log(chalk.green('Checking port availability...'));

                const isBackendFree = await checkPort(BACKEND_PORT);
                const isFrontendFree = await checkPort(FRONTEND_PORT);

                try {
                    if (!isBackendFree) {
                        console.log(chalk.red(`Port ${BACKEND_PORT} is in use. Server may already be running.`));
                    } else {
                        const backendPath = path.join(__dirname, 'proxy.js');
                        backendProcess = spawn('node', [backendPath], {
                            stdio: 'inherit',
                            detached: true
                        });
                        console.log(chalk.green(`Backend started on port ${BACKEND_PORT}`));
                    }

                    if (!isFrontendFree) {
                        console.log(chalk.red(`Port ${FRONTEND_PORT} is in use. Server may already be running.`));
                    } else {
                        const frontendDir = path.join(process.cwd(), 'local.netget', 'frontend');
                        // Open a new terminal window and run 'npm run dev'
                        const terminalCmd = process.platform === 'win32'
                            ? `start cmd /k "cd /d ${frontendDir} && npm run dev"`
                            : `gnome-terminal -- bash -c "cd '${frontendDir}' && npm run dev; exec bash"`;

                        exec(terminalCmd, (err) => {
                            if (err) {
                                console.error(chalk.red(`Error opening terminal for frontend: ${err.message}`));
                            }
                        });
                        console.log(chalk.green(`Frontend started on port ${FRONTEND_PORT} in a new terminal window.`));
                    }
                } catch (error: any) {
                    console.error(chalk.red(`Error starting servers: ${error.message}`));
                }
                break;

            case '2. Stop Local NetGet Server':
                console.clear();
                console.log(chalk.yellow('Stopping servers...'));

                await killProcessOnPort(BACKEND_PORT);
                await killProcessOnPort(FRONTEND_PORT);

                console.log(chalk.green('Servers stopped successfully.'));
                break;

            case '3. View Logs':
                await viewLogs();
                break;

            case '5. Exit':
                console.log(chalk.blue('Exiting NetGet...'));
                process.exit();
                break;

            default:
                console.log(chalk.red('Invalid choice, please try again.'));
                break;
        }
    }
}
