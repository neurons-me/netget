// netget/src/modules/NGINX/nginxManager.js
import { execShellCommand, handlePermission, checkAndSetFilePermissions } from '../utils/handlePermissions.js';
import chalk from 'chalk';
const nginxExecutablePath = '/sbin/nginx';
const requiredPermissions = '755';

const checkNginxStatus = async () => {
    try {
    // Ensure the nginx executable has the correct permissions
    await checkAndSetFilePermissions(nginxExecutablePath, requiredPermissions);
    const result = await execShellCommand(`${nginxExecutablePath} -t`);
    console.log(chalk.green('NGINX is configured correctly.'));
    console.log(result);
    } catch (error) {
    console.error(chalk.red('Permission denied error:'), error);
    await handlePermission('checking NGINX status', `${nginxExecutablePath} -t`, 'Ensure the nginx executable has the correct permissions and try again.');
    }
};

// Example function to manage NGINX
const manageNginx = async () => {
    try {
    console.log(chalk.blue('Checking NGINX status...'));
    await checkNginxStatus();
    } catch (error) {
    console.error(chalk.red('Failed to manage NGINX:'), error);
    }
};

export { manageNginx };
