//nginxInstallationOptions.cli.js
import chalk from 'chalk';
import inquirer from 'inquirer';
import installNginx from './installNginx.js';  
export default async function nginxInstallationOptions() {
    console.log("NGINX installation options are available. We recommend installing NGINX solely for NetGet and doing the configurations through the NetGet tools to avoid conflicts. If you want to use NGINX for other configurations and services please do so at your own risk and refer to both NGINX and NetGet manuals for help.");
    const installConfirmation = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmInstall',
            message: 'NGINX is not installed. Would you like to install it now?',
            default: true
        },
        {
            type: 'list',
            name: 'version',
            message: 'Choose which version of NGINX you want to install:',
            choices: ['Stable', 'Mainline', 'Custom version', 'Back to previous menu'],
            when: (answers) => answers.confirmInstall
        },
        {
            type: 'input',
            name: 'customVersion',
            message: 'Enter the custom version you wish to install:',
            when: (answers) => answers.version === 'Custom version'
        }
    ]);

    switch (installConfirmation.version) {
        case 'Stable':
        case 'Mainline':
        case 'Custom version':
            const installationResult = await installNginx(installConfirmation.version, installConfirmation.customVersion);
            return installationResult; // Return the result of the installation
        case 'Back to previous menu':
            await nxConfigMenu(); // Call the main configuration menu again
            break;
        default:
            console.log(chalk.yellow('Installation aborted by the user.'));
            await nxConfigMenu(); // Optionally return to config menu
    }
}
