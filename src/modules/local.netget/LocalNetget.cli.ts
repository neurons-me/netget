// local.netget.cli.ts
import inquirer from 'inquirer';
import chalk from 'chalk';

interface MenuAnswers {
    option: string;
}

export default async function LocalNetgetCLI(): Promise<void> {
    console.log(chalk.blue('Welcome to Local NetGet!'));

    let exit = false;
    while (!exit) {
        const answers = await inquirer.prompt<MenuAnswers>({
            type: 'list',
            name: 'option',
            message: 'Select an action:',
            choices: [
                '1. Start Local NetGet',
                '2. Back'
            ]
        });

        switch (answers.option) {
            case '1. Start Local NetGet':
                console.clear();
                console.log(chalk.green('Local NetGet development environment is ready.'));
                console.log(chalk.yellow('You may enter http://local.netget to access NetGet through your browser.'));
                break;
            case '2. Back':
                console.clear();
                return;
            default:
                console.log(chalk.red('Invalid choice, please try again.'));
                break;
        }
    }
}
