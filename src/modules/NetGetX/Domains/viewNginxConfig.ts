// netget/src/modules/NetGetX/Domains/viewNginxConfig.ts
import chalk from 'chalk';
import { loadXConfig, XConfig } from '../config/xConfig.ts';
import { getDomainByName, DomainRecord } from '../../../sqlite/utils_sqlite3.ts';

/**
 * Views the NGINX configuration for a domain by displaying the configuration from the database.
 * @memberof module:NetGetX.Domains
 * @param domain - The domain for which to view the NGINX configuration.
 */
const viewNginxConfig = async (domain: string): Promise<void> => {
    try {
        const xConfig: XConfig = await loadXConfig();
        const domainConfig = xConfig.domains?.[domain];

        if (!domainConfig) {
            console.log(chalk.red(`Domain ${domain} configuration not found in xConfig.`));
            // Still try to get from database
        }

        const dbDomainConfig: DomainRecord | null = await getDomainByName(domain);
        
        if (!dbDomainConfig) {
            console.log(chalk.red(`Domain ${domain} not found in database.`));
            return;
        }

        console.log(chalk.blue(`Current NGINX configuration for ${domain} from database:`));
        console.log(chalk.green(dbDomainConfig.nginxConfig || 'No NGINX configuration found'));
    } catch (error: any) {
        console.error(chalk.red(`Error viewing NGINX config for ${domain}: ${error.message}`));
    }
};

export default viewNginxConfig;