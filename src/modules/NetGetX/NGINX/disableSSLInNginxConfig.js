// netget/src/modules/NetGetX/NGINX/disableSSLInNginxConfig.js
import handlePermission from '../../utils/handlePermissions.js'; // Adjust path as necessary
import chalk from 'chalk';
import { exec } from 'child_process';

const disableSSLInNginxConfig = (nginxConfigPath) => {
    return new Promise(async (resolve, reject) => {
        const backupPath = `${nginxConfigPath}.backup`;
        const taskDescription = 'backup NGINX configuration';
        const autoCommand = `sudo cp ${nginxConfigPath} ${backupPath}`;
        const manualInstructions = `To manually backup the NGINX configuration, run:\n\nsudo cp ${nginxConfigPath} ${backupPath}`;

        try {
            await handlePermission(taskDescription, autoCommand, manualInstructions);
            exec(`sudo sed -i '/ssl_certificate/d;/ssl_certificate_key/d' ${nginxConfigPath}`, (err) => {
                if (err) {
                    console.error(chalk.red(`Failed to modify NGINX configuration: ${err.message}`));
                    reject(err);
                    return;
                }
                resolve(true);
            });
        } catch (err) {
            console.error(chalk.red(`Failed to backup NGINX configuration: ${err.message}`));
            reject(err);
        }
    });
};

const restoreNginxConfig = (nginxConfigPath) => {
    return new Promise(async (resolve, reject) => {
        const backupPath = `${nginxConfigPath}.backup`;
        const taskDescription = 'restore NGINX configuration';
        const autoCommand = `sudo cp ${backupPath} ${nginxConfigPath}`;
        const manualInstructions = `To manually restore the NGINX configuration, run:\n\nsudo cp ${backupPath} ${nginxConfigPath}`;

        try {
            await handlePermission(taskDescription, autoCommand, manualInstructions);
            resolve(true);
        } catch (err) {
            console.error(chalk.red(`Failed to restore NGINX configuration: ${err.message}`));
            reject(err);
        }
    });
};

export { disableSSLInNginxConfig, restoreNginxConfig };
