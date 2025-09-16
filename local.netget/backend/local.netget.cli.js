import { exec } from 'child_process';
import net from 'net';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';

const BACKEND_PORT = 3000;
const FRONTEND_PORT = 5173;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFilePath = path.join(__dirname, 'server.log');

// Function to check if a port is available
function checkPort(port) {
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
function killProcessOnPort(port) {
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

import { spawn } from 'child_process';

async function viewLogs() {
    console.log(chalk.yellow('\n=== Viewing Logs ===\n'));

    const logs = spawn('tail', ['-f', logFilePath]);

    logs.stdout.pipe(process.stdout);
    logs.stderr.pipe(process.stderr);
}


export default async function LocalNetgetCLI(x) {
    console.log(chalk.blue('Welcome to Local NetGet!'));

    let backendProcess, frontendProcess;

    let exit = false;
    while (!exit) {
        const answers = await inquirer.prompt({
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
                        // Use path.join and __dirname to build the backend path dynamically
                        const backendPath = path.join(__dirname, 'proxy.js');
                        backendProcess = exec(`node "${backendPath} --development"`, (err) => {
                        });
                        backendProcess.stdout.pipe(process.stdout);
                        backendProcess.stderr.pipe(process.stderr);
                        console.log(chalk.green(`Backend started on port ${BACKEND_PORT}`));
                    }

                    if (!isFrontendFree) {
                        console.log(chalk.red(`Port ${FRONTEND_PORT} is in use. Server may already be running.`));
                    } else {
                        // Construye la ruta al frontend dinámicamente usando __dirname
                        const frontendDir = path.join(__dirname, '..', '..', '..', 'domains', 'local.netget', 'frontend');
                        frontendProcess = exec('npm run dev', { cwd: frontendDir }, (err) => {
                        });
                        frontendProcess.stdout.pipe(process.stdout);
                        frontendProcess.stderr.pipe(process.stderr);
                        console.log(chalk.green(`Frontend started on port ${FRONTEND_PORT}`));
                    }
                } catch (error) {
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
