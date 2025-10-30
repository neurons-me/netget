// remoteDeployer.ts
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { loadXConfig } from '../../NetGetX/config/xConfig.ts';

const xConfig = await loadXConfig();
const sqliteDatabasePath: string = xConfig.sqliteDatabasePath;

interface DeployerConfig {
    dbPath?: string;
    projectsBasePath?: string;
    authorizedKeys?: string[];
}

interface DomainConfig {
    domain: string;
    subdomain: string;
    email: string;
    sslMode: string;
    sslCertificate: string;
    sslCertificateKey: string;
    target: string;
    type: string;
    projectPath: string;
    owner: string;
}

interface UpdateResult {
    message: string;
    processedCount: number;
}

interface DeployResult {
    message: string;
    path: string;
}

interface HealthCheckResult {
    status: string;
    database?: string;
    openresty?: string;
    error?: string;
    timestamp: string;
}

export class RemoteDeployer {
    private dbPath: string;
    private projectsBasePath: string;
    private authorizedKeys: string[];

    constructor(config: DeployerConfig) {
        this.dbPath = config.dbPath || sqliteDatabasePath;
        this.projectsBasePath = config.projectsBasePath || '/var/www';
        this.authorizedKeys = config.authorizedKeys || [];
    }

    /**
     * Verify API key authorization
     */
    verifyApiKey(apiKey: string): boolean {
        return this.authorizedKeys.includes(apiKey);
    }

    /**
     * Update domain configurations in remote database
     */
    async updateDomainConfigs(domains: DomainConfig[], updateTarget: boolean = true): Promise<UpdateResult> {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(new Error(`Failed to open database: ${err.message}`));
                    return;
                }
            });

            // Start transaction
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                // Create table if not exists
                db.run(`
                    CREATE TABLE IF NOT EXISTS domains (
                        domain TEXT PRIMARY KEY,
                        subdomain TEXT,
                        email TEXT,
                        sslMode TEXT,
                        sslCertificate TEXT,
                        sslCertificateKey TEXT,
                        target TEXT,
                        type TEXT,
                        projectPath TEXT,
                        owner TEXT
                    )
                `);

                // Prepare insert/update statement
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO domains 
                    (domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                let processedCount = 0;
                let errors: string[] = [];

                domains.forEach((domain, index) => {
                    // Ensure domain.target is updated if requested
                    if (updateTarget) {
                        domain.target = path.join(this.projectsBasePath, domain.domain);
                    }
                    stmt.run([
                        domain.domain,
                        domain.subdomain,
                        domain.email,
                        domain.sslMode,
                        domain.sslCertificate,
                        domain.sslCertificateKey,
                        domain.target,
                        domain.type,
                        domain.projectPath,
                        domain.owner
                    ], function (err) {
                        if (err) {
                            errors.push(`Domain ${domain.domain}: ${err.message}`);
                        } else {
                            processedCount++;
                        }

                        // If this is the last domain
                        if (index === domains.length - 1) {
                            stmt.finalize();

                            if (errors.length > 0) {
                                db.run("ROLLBACK");
                                db.close();
                                reject(new Error(`Failed to update domains: ${errors.join(', ')}`));
                            } else {
                                db.run("COMMIT", (err) => {
                                    if (err) {
                                        reject(new Error(`Failed to commit transaction: ${err.message}`));
                                    } else {
                                        db.close();
                                        resolve({
                                            message: `Successfully updated ${processedCount} domains`,
                                            processedCount
                                        });
                                    }
                                });
                            }
                        }
                    });
                });
            });
        });
    }

    /**
     * Deploy project files
     */
    async deployProject(domain: string, fileBuffer: Buffer): Promise<DeployResult> {
        try {
            const projectDir = path.join(this.projectsBasePath, domain);
            console.log(`Deploying project for domain: ${domain} to ${projectDir}`);
            // Create project directory if it doesn't exist
            await fs.mkdir(projectDir, { recursive: true });

            // Write uploaded file to temp location
            const tempZipPath = path.join('/tmp', `${domain}-${Date.now()}.zip`);
            await fs.writeFile(tempZipPath, fileBuffer);

            // Extract zip file
            const extractDir = path.join(projectDir, 'dist');

            // Remove existing deployment
            try {
                await fs.rm(extractDir, { recursive: true, force: true });
            } catch (error: any) {
                // Directory might not exist, ignore
                console.log(`   ❌ Failed to remove existing deployment for ${domain}: ${error.message}`);
            }

            // Create extraction directory
            await fs.mkdir(extractDir, { recursive: true });

            // Extract files
            execSync(`unzip -q "${tempZipPath}" -d "${extractDir}"`);

            // Clean up temp file
            await fs.unlink(tempZipPath);

            // Install dependencies if package.json exists
            const packageJsonPath = path.join(extractDir, 'package.json');
            try {
                await fs.access(packageJsonPath);
                console.log(`Installing dependencies for ${domain}...`);
                execSync('npm install --production', { cwd: extractDir });
            } catch (error: any) {
                // No package.json or npm install failed, continue
                console.log(`   ❌ Failed to install dependencies for ${domain}: ${error.message}`);
            }

            // Build project if build script exists
            try {
                const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
                if (packageJson.scripts && packageJson.scripts.build) {
                    console.log(`Building project for ${domain}...`);
                    execSync('npm run build', { cwd: extractDir });
                }
            } catch (error: any) {
                // No build script or build failed, continue
                console.log(`   ❌ Failed to build ${domain}: ${error.message}`);
            }

            return {
                message: `Project deployed successfully to ${extractDir}`,
                path: extractDir
            };

        } catch (error: any) {
            throw new Error(`Deployment failed: ${error.message}`);
        }
    }

    /**
     * Get current domain configurations
     */
    async getDomainConfigs(): Promise<DomainConfig[]> {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    reject(new Error(`Failed to open database: ${err.message}`));
                    return;
                }
            });

            const query = `
                SELECT domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, 
                       target, type, projectPath, owner 
                FROM domains 
                ORDER BY domain
            `;

            db.all(query, [], (err, rows: DomainConfig[]) => {
                if (err) {
                    reject(new Error(`Failed to read domains: ${err.message}`));
                    return;
                }

                db.close();
                resolve(rows);
            });
        });
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<HealthCheckResult> {
        try {
            // Check database connectivity
            await this.getDomainConfigs();

            // Check nginx status
            const openrestyStatus = execSync('systemctl is-active openresty').toString().trim();

            return {
                status: 'healthy',
                database: 'connected',
                openresty: openrestyStatus,
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}
