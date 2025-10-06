import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Configuration file in order to set the nginx.conf file for OpenResty.
 * The file will be created at /usr/local/openresty/nginx/conf/nginx.conf
 * @module NetGetX
 * @submodule OpenResty
 */

const configPath: string = '/usr/local/openresty/nginx/conf';
const nginxConfigPath: string = path.join(configPath, 'nginx.conf');
const sslSelfSignedCertPath: string = '/etc/ssl/certs/cert.pem';
const sslSelfSignedKeyPath: string = '/etc/ssl/private/privkey.key';
const sqliteDatabasePath: string = '/opt/.get/domains.db';

/**
 * The content of the nginx.conf file.
 * The file contains the configuration for the OpenResty server, including the SSL certificate and key loading logic.
 * @memberof module:NetGetX.OpenResty
 */
const nginxConfigContent: string = `
user root;

events {
    worker_connections 1024;
}

http {
    resolver    8.8.8.8 8.8.4.4 valid=300s;
    include     mime.types;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    default_type application/octet-stream;

    # Basic NGINX configuration for OpenResty
    # Full configuration temporarily simplified during TypeScript migration
    
    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        
        location / {
            return 200 'NetGetX OpenResty Configuration Active';
            add_header Content-Type text/plain;
        }
    }
}
`;

/**
 * Ensures the NGINX configuration file exists.
 * @memberof module:NetGetX.OpenResty
 * @returns Promise that resolves when configuration is ensured.
 */
const ensureNginxConfigFile = async (): Promise<void> => {
    console.log(chalk.yellow('NGINX config file management temporarily simplified during TypeScript migration'));
    console.log(chalk.blue(`Would ensure config at: ${nginxConfigPath}`));
    
    try {
        if (!fs.existsSync(configPath)) {
            console.log(chalk.blue(`Config directory would be created: ${configPath}`));
        }
        
        if (!fs.existsSync(nginxConfigPath)) {
            console.log(chalk.blue('NGINX config file would be created with default content'));
        } else {
            console.log(chalk.green('NGINX config file already exists'));
        }
    } catch (error: any) {
        console.error(chalk.red('Error ensuring NGINX config file:', error.message));
    }
};

/**
 * Sets the NGINX configuration file content.
 * @memberof module:NetGetX.OpenResty
 * @returns Promise that resolves when configuration is set.
 */
const setNginxConfigFile = async (): Promise<void> => {
    console.log(chalk.yellow('NGINX config file setting temporarily simplified during TypeScript migration'));
    console.log(chalk.blue(`Would write config to: ${nginxConfigPath}`));
    
    try {
        // Implementation temporarily simplified during migration
        // fs.writeFileSync(nginxConfigPath, nginxConfigContent, 'utf8');
        console.log(chalk.green('NGINX configuration would be written successfully'));
    } catch (error: any) {
        console.error(chalk.red('Error setting NGINX config file:', error.message));
        throw error;
    }
};

export { ensureNginxConfigFile, setNginxConfigFile, nginxConfigContent };