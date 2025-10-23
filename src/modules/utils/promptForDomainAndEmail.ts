// promptForDomainAndEmail.ts
import inquirer from 'inquirer';

interface XConfig {
    domain?: string;
    email?: string;
    [key: string]: any;
}

/**
 * Prompts the user for the domain and email if they are not already set in the configuration.
 * @param {XConfig} xConfig - The user configuration object.
 * @returns {Promise<XConfig>} - The updated configuration object.
*/
async function promptForDomainAndEmail(xConfig: XConfig): Promise<XConfig> {
    const questions: any[] = [];
    if (!xConfig.domain) {
        questions.push({
            type: 'input',
            name: 'domain',
            message: 'Please enter your domain:',
            validate: (input: string) => input ? true : 'Domain is required.'
        });
    }
    if (!xConfig.email) {
        questions.push({
            type: 'input',
            name: 'email',
            message: 'Please enter your email:',
            validate: (input: string) => input && /\S+@\S+\.\S+/.test(input) ? true : 'A valid email is required.'
        });
    }
    if (questions.length > 0) {
        const answers = await inquirer.prompt(questions);
        // Note: saveXConfig and loadOrCreateXConfig should be imported if they exist
        // For now, just merging answers into xConfig
        xConfig = { ...xConfig, ...answers };
    }
    return xConfig;
}

export default promptForDomainAndEmail;
