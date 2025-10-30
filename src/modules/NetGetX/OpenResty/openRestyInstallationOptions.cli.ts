import chalk from 'chalk';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import { handlePermission } from '../../utils/handlePermissions.ts';
import verifyOpenRestyInstallation from './verifyOpenRestyInstallation.ts';
import NetGetMainMenu from '../../netget_MainMenu.cli.ts';
// Interface for installation choices
interface InstallChoice {
    name: string;
    value: '1' | '2';
}

// Interface for installation answers
interface InstallAnswers {
    choice: '1' | '2';
}

// Interface for path answers
interface PathAnswers {
    addToPath: boolean;
}

/**
 * Provides options to install OpenResty.
 * @memberof module:NetGetX.OpenResty
 */
export default async function openRestyInstallationOptions(): Promise<void> {
    const choices: InstallChoice[] = [
        { name: 'Install from source', value: '1' },
        { name: 'Exit', value: '2' }
    ];

    const answers: InstallAnswers = await inquirer.prompt([
        {
            type: 'list',
            name: 'choice',
            message: 'Starting OpenResty installation, may take a few minutes...\n'+
            'Documentation for OpenResty installation can be found at https://openresty.org/en/installation.html\n'+
            'Please choose an installation method:',
            choices: choices
        }
    ]);

    switch (answers.choice) {
        case '1':
            try {
                chalk.green(console.log('Starting OpenResty installation'));
                const VERSION = "1.27.1.1";
                const TARBALL = `openresty-${VERSION}.tar.gz`;
                const DOWNLOAD_URL = `https://openresty.org/download/${TARBALL}`;

                if (process.platform === 'linux') {
                    console.log(chalk.blue(`Downloading OpenResty ${VERSION} from ${DOWNLOAD_URL}...`));
                    execSync(`curl -fSL ${DOWNLOAD_URL} -o ${TARBALL}`);
                    console.log(chalk.blue('Download completed. Proceeding with installation...'));
                    console.log(chalk.blue('Extracting files...'));
                    execSync(`tar -xzf ${TARBALL}`);
                    const DIR = `openresty-${VERSION}`;
                    console.log(chalk.blue('Configuring and installing OpenResty...'));
                    process.chdir(DIR);
                    execSync(`./configure -j2`);
                    console.log(chalk.blue("Compiling source..."));
                    execSync(`make -j2`);
                    console.log(chalk.green("Files compiled successfully. You may now install OpenResty."));
                    await handlePermission(
                        'Openresty Installation needs elevated privileges in order to make install.',
                        'sudo make install',
                        'Please run the following command manually to install OpenResty:\n' +
                        'sudo make install'
                    );
                } else if (process.platform === 'darwin') {
                    console.log(chalk.blue('Detected macOS. Installing OpenResty via Homebrew...'));

                    let isBrewInstalled = true;
                    try {
                        execSync(`command -v brew >/dev/null 2>&1`);
                    } catch (error) {
                        isBrewInstalled = false;
                    }

                    if (!isBrewInstalled) {
                        console.log(chalk.blue(`Homebrew not found. Installing Homebrew...`));
                        try {
                            execSync(`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`, { stdio: 'inherit' });
                        } catch (error) {
                            console.error(chalk.red('Failed to install Homebrew. Please install it manually and retry.'));
                            return;
                        }
                    }

                    console.log(chalk.blue(`Installing OpenResty via Homebrew...`));
                    try {
                        execSync(`brew install openresty/brew/openresty`, { stdio: 'inherit' });
                        console.log(chalk.green(`OpenResty installed via Homebrew successfully.`));
                    } catch (error) {
                        console.error(chalk.red(`Failed to install OpenResty via Homebrew. Please check the error and try again.`));
                    }
                } else if (process.platform === 'win32') {
                    console.log(chalk.red('Automatic installation of OpenResty on Windows is not supported. Please refer to the documentation at https://openresty.org/en/installation.html'));
                }
                console.clear();
                let openRestyInstalled: boolean = await verifyOpenRestyInstallation();
                if (openRestyInstalled) {
                    console.log('OpenResty installation completed via Linux_openresty.sh');
                    await askToAddToPath();
                }
            } catch (error: any) {
                    console.error(chalk.red('Failed to install OpenResty from source,\n'+
                    'please refer to the documentation at https://openresty.org/en/installation.html')
                );
            }
            break;
        case '2':
            return await NetGetMainMenu();
        default:
            console.log('Invalid choice. Exiting...');
            break;
    }
}

async function askToAddToPath() {
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'addToPath',
            message: 'Do you want to add OpenResty to your PATH?',
            default: true
        }
    ]);

    if (answer.addToPath) {
        try {
            await handlePermission(
                'Adding OpenResty to PATH requires elevated privileges.',
                'echo "export PATH=/usr/local/openresty/bin:$PATH" >> ~/.bashrc',
                'Please run the following command manually to add OpenResty to your PATH:\n' +
                'echo "export PATH=/usr/local/openresty/bin:$PATH" >> ~/.bashrc'
            );
            console.log('OpenResty added to PATH successfully.');
        } catch (error) {
            console.error('Failed to add OpenResty to PATH.');
        }
    } else {
        console.log('OpenResty not added to PATH.');
    }
}