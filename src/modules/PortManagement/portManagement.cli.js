// portManagement.cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import { exec } from 'child_process';
import util from 'util';
import pm2 from 'pm2';
import NetGetMainMenu from '../netget_MainMenu.cli.js';

const execPromise = util.promisify(exec);

/**
 * Port Management CLI  
 * @memberof module:PortManagement
 *  
 */
export async function PortManagement_CLI() {
    console.clear();
    console.log(chalk.green('Port Management Menu'));

    const actions = ['What\'s On Port?', 'Kill Process On Port', 'Go Back'];
    const { action } = await inquirer.prompt({
        type: 'list',
        name: 'action',
        message: 'Select an action:',
        choices: actions,
    });

    switch (action) {
    
        case 'What\'s On Port?':
            const { portToCheck } = await inquirer.prompt({
                type: 'input',
                name: 'portToCheck',
                message: 'Enter the port number to check:',
                validate: value => !isNaN(value) || 'Please enter a valid number',
            });

            try {
                const { stdout, stderr } = await execPromise(`lsof -i :${portToCheck}`);
                if (stderr) {
                    console.error(chalk.red('Error:'), stderr);
                } else if (!stdout.trim()) {
                    console.log(chalk.yellow(`No processes running on port ${portToCheck}.`));
                } else {
                    console.log(chalk.green(`Processes running on port ${portToCheck}:\n`), stdout);
                }
            } catch (error) {
                if (error.code === 1) {
                    console.log(chalk.yellow(`No processes running on port ${portToCheck}.`));
                } else {
                    console.error(chalk.red('Error fetching port details:'), error);
                }
            }
            break;

        case 'Kill Process On Port':
            const { portToKill } = await inquirer.prompt({
                type: 'input',
                name: 'portToKill',
                message: 'Enter the port number to kill processes on:',
                validate: value => !isNaN(value) || 'Please enter a valid number',
            });

            try {
                const { stdout, stderr } = await execPromise(`lsof -i :${portToKill} -t`);
                if (stderr) {
                    console.error(chalk.red('Error:'), stderr);
                } else {
                    const pids = stdout.split('\n').filter(Boolean);
                    if (pids.length > 0) {
                        for (const pid of pids) {
                            console.log(chalk.yellow(`Found process with PID ${pid} on port ${portToKill}.`));

                            // Check if the process is managed by PM2
                            const { stdout: pm2List } = await execPromise(`pm2 jlist`);
                            const pm2Processes = JSON.parse(pm2List);
                            const pm2Process = pm2Processes.find(proc => proc.pid == pid);

                            if (pm2Process) {
                                console.log(chalk.yellow(`Process with PID ${pid} is managed by PM2.`));
                                await stopPM2Process(pm2Process.name);
                            } else {
                                console.log(chalk.yellow(`Process with PID ${pid} is not managed by PM2. Attempting to kill...`));
                                // Kill the process if not managed by PM2
                                const { stdout: killOutput, stderr: killError } = await execPromise(`kill -9 ${pid}`);
                                if (killError) {
                                    console.error(chalk.red(`Failed to kill process with PID ${pid}:`), killError);
                                } else {
                                    console.log(chalk.green(`Killed process with PID ${pid} on port ${portToKill}.`));
                                    console.log(chalk.green(`Kill output: ${killOutput}`));
                                }
                            }
                        }
                    } else {
                        console.log(chalk.yellow(`No processes found on port ${portToKill}.`));
                    }
                }
            } catch (error) {
                console.error(chalk.red('Error fetching port details or killing processes:'), error);
            }
            break;

        case 'Go Back':
            console.clear();  // Clear the console when going back to the main menu
            console.log(chalk.blue('Returning to the main menu...'));
            await NetGetMainMenu();
            return;

        default:
            console.log(chalk.red('Invalid choice, please try again.'));
            break;
    }

    // Wait for user to press enter before returning to the main menu
    await inquirer.prompt({
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...',
    });

    await PortManagement_CLI(); // Show the Port Management menu again after an action
}

async function stopPM2Process(processName) {
    return new Promise((resolve, reject) => {
        pm2.connect(err => {
            if (err) {
                console.error(chalk.red('PM2 connection error:'), err);
                return reject(err);
            }

            pm2.stop(processName, err => {
                if (err) {
                    console.error(chalk.red(`Failed to stop PM2 process ${processName}:`), err);
                    pm2.disconnect();
                    return reject(err);
                }

                console.log(chalk.green(`Stopped PM2 process ${processName}.`));
                pm2.disconnect();
                resolve();
            });
        });
    });
}