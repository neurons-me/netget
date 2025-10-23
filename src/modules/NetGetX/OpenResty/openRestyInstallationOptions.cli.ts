import { execSync } from 'child_process';
import inquirer from 'inquirer';
import NetGetX_CLI from '../NetGetX.cli.ts';
import { i_DefaultNetGetX } from '../config/i_DefaultNetGetX.ts';

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
            message: 'OpenResty is not installed. Please choose an installation method:',
            choices: choices
        }
    ]);

    switch (answers.choice) {
        case '1':
            try {
                console.log('OpenResty installation temporarily simplified during TypeScript migration');
                console.log('Would install OpenResty from source...');
                
                execSync('wget https://openresty.org/download/openresty-1.27.1.1.tar.gz');
                execSync('tar -xzvf openresty-1.27.1.1.tar.gz');
                execSync('cd openresty-1.27.1.1 && ./configure && make && sudo make install');
                
                console.log('OpenResty installation would complete successfully');
                await askToAddToPath();
            } catch (error: any) {
                console.error('Failed to install OpenResty from source.');
            }
            break;
        case '2':
            console.log('Exiting installation options.');
            const x = await i_DefaultNetGetX();
            if (x) {
                /*
                Netget X (The Router/Conductor)
                Role: Acts as the central orchestrator,
                running an Nginx server and managing domain routing.
                */
                await NetGetX_CLI(x);
            }
            break;
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
            execSync('echo "export PATH=/usr/local/openresty/bin:$PATH" >> ~/.bashrc');
            execSync('source ~/.bashrc');
            console.log('OpenResty added to PATH successfully.');
        } catch (error) {
            console.error('Failed to add OpenResty to PATH.');
        }
    } else {
        console.log('OpenResty not added to PATH.');
    }
}