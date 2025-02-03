/**
 * Prompts the user for the domain and email if they are not already set in the configuration.
 * @param {Object} xConfig - The user configuration object.
*/
async function promptForDomainAndEmail(xConfig) {
    const questions = [];
    if (!xConfig.domain) {
        questions.push({
            type: 'input',
            name: 'domain',
            message: 'Please enter your domain:',
            validate: input => input ? true : 'Domain is required.'
        });
    }
    if (!xConfig.email) {
        questions.push({
            type: 'input',
            name: 'email',
            message: 'Please enter your email:',
            validate: input => input && /\S+@\S+\.\S+/.test(input) ? true : 'A valid email is required.'
        });
    }
    if (questions.length > 0) {
        const answers = await inquirer.prompt(questions);
        await saveXConfig(answers);
        xConfig = await loadOrCreateXConfig();
    }
    return xConfig;
}

export default promptForDomainAndEmail;
