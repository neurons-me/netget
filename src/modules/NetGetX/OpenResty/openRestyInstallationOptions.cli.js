import { execSync } from 'child_process';
import readline from 'readline';
import NetGetX_CLI from '../NetGetX.cli.js';

/**
 * Provides options to install OpenResty.
 */
export default async function openRestyInstallationOptions() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('OpenResty is not installed. Please choose an installation method:');
    console.log('1. Install from source');
    console.log('2. Exit');

    rl.question('Enter your choice (1 or 2): ', async (choice) => {
        switch (choice) {
            case '1':
                try {
                    console.log('Installing OpenResty from source...');
                    execSync('wget https://openresty.org/download/openresty-1.27.1.1.tar.gz');
                    execSync('tar -xzvf openresty-1.27.1.1.tar.gz');
                    execSync('cd openresty-1.27.1.1 && ./configure && make && sudo make install');
                    console.log('OpenResty installed successfully from source.');
                    await askToAddToPath();
                } catch (error) {
                    console.error('Failed to install OpenResty from source.');
                }
                break;
            case '2':
                console.log('Exiting installation options.');
                await NetGetX_CLI();
                break;
            default:
                console.log('Invalid choice. Exiting.');
                break;
        }
        rl.close();
    });

    async function askToAddToPath() {
        rl.question('Do you want to add OpenResty to your PATH? (Y/n): ', (answer) => {
            if (answer.toLowerCase() === 'y' || answer === '') {
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
            rl.close();
        });
    }
}
