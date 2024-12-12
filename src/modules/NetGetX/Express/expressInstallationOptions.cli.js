import fs from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import NetGetMainMenu from '../../netget_MainMenu.cli.js';
import { createRequire } from 'module';
import { saveXConfig, loadOrCreateXConfig } from '../config/xConfig.js';
import { execSync } from 'child_process';

async function handleExpressInstallation(installConfirmation) {
    switch (installConfirmation.version) {
        case 'Latest':
            try {
                console.log(chalk.blue('Installing Express...'));
                execSync('npm install -g express');
                console.log(chalk.green('Express installed.'));
            } catch (error) {
                console.error(chalk.red('Error installing Express.'));
                console.error(chalk.red(error));
                console.log(chalk.blue('Returning to the main menu...'));
                return;
            }
            break;
        case 'Custom version':
            try {
                console.log(chalk.blue('Installing Express...'));
                execSync(`npm install express@${installConfirmation.customVersion} --save`);
                console.log(chalk.green('Express installed.'));
            } catch (error) {
                console.error(chalk.red('Error installing Express.'));
                console.error(chalk.red(error));
                console.log(chalk.blue('Returning to the main menu...'));
                return;
            }
            break;
        case 'Back to previous menu':
            console.log(chalk.blue('Returning to the main menu...'));
            await NetGetMainMenu();
            break;
        default:
            console.log(chalk.yellow('Installation aborted by the user.'));
            console.log(chalk.blue('Returning to the main menu...'));
            await NetGetMainMenu();
            break;
    }
}


function isPathValid(module) {
    try {
        const path =  getNodePath(module);
        fs.existsSync(path);
        return true;
    } catch (error) {
        return false;
    }
}

function getNodePath(path) {
    const require = createRequire(import.meta.url);
    return require.resolve(path);
}

// Install Express
async function installExpress() {
    console.log(chalk.blue('Installing Express...'));

    const installConfirmation = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmInstall',
            message: 'Express is not installed. Would you like to install it now?',
            default: true
        },
        {
            type: 'list',
            name: 'version',
            message: 'Choose which version of Express you want to install:',
            choices: ['Latest', 'Custom version', 'Back to previous menu'],
            when: (answers) => answers.confirmInstall
        },
        {
            type: 'input',
            name: 'customVersion',
            message: 'Enter the custom version you wish to install:',
            when: (answers) => answers.version === 'Custom version'
        }
    ]);
    
    
    if (!installConfirmation.confirmInstall) {
        console.log(chalk.blue('Installation aborted by the user.'));
        console.log(chalk.blue('Returning to the main menu...'));
        await NetGetMainMenu();
        return;
    }
    
    await handleExpressInstallation(installConfirmation.version);
}

export async function verifyExpressInstallation() {
    const expressInstalled = isPathValid('express');

    if (expressInstalled) {
        console.log(chalk.blue('Express is installed.'));
    }
    else {
        console.log(chalk.blue('Express is not installed.'));
        await installExpress();
    }
}


export async function getExpressConfig() {
    const xConfig = await loadOrCreateXConfig();
    
    if (!xConfig.ExpressPath) {
        try {
            const expressPath = execSync('npm root -g').toString().trim() + '/express';
            await saveXConfig({ ExpressPath: expressPath });
        } catch (error) {
            console.error(chalk.red('Failed to determine ExpressPath.'));
        }
    }
}