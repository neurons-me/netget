import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';

export class RemoteDeployer {
  constructor(config) {
    this.dbPath = config.dbPath || '/opt/.get/domains.db';
    this.projectsBasePath = config.projectsBasePath || '/var/www';
    this.nginxConfigPath = config.nginxConfigPath || '/etc/nginx/sites-available';
    this.nginxEnabledPath = config.nginxEnabledPath || '/etc/nginx/sites-enabled';
    this.authorizedKeys = config.authorizedKeys || [];
  }

  /**
   * Verify API key authorization
   */
  verifyApiKey(apiKey) {
    return this.authorizedKeys.includes(apiKey);
  }

  /**
   * Update domain configurations in remote database
   */
  async updateDomainConfigs(domains) {
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
        let errors = [];

        domains.forEach((domain, index) => {
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
          ], function(err) {
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
  async deployProject(domain, fileBuffer) {
    try {
      const projectDir = path.join(this.projectsBasePath, domain);
      
      // Create project directory if it doesn't exist
      await fs.mkdir(projectDir, { recursive: true });

      // Write uploaded file to temp location
      const tempZipPath = path.join('/tmp', `${domain}-${Date.now()}.zip`);
      await fs.writeFile(tempZipPath, fileBuffer);

      // Extract zip file
      const extractDir = path.join(projectDir, 'current');
      
      // Remove existing deployment
      try {
        await fs.rm(extractDir, { recursive: true, force: true });
      } catch (error) {
        // Directory might not exist, ignore
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
      } catch (error) {
        // No package.json or npm install failed, continue
      }

      // Build project if build script exists
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        if (packageJson.scripts && packageJson.scripts.build) {
          console.log(`Building project for ${domain}...`);
          execSync('npm run build', { cwd: extractDir });
        }
      } catch (error) {
        // No build script or build failed, continue
      }

      return {
        message: `Project deployed successfully to ${extractDir}`,
        path: extractDir
      };

    } catch (error) {
      throw new Error(`Deployment failed: ${error.message}`);
    }
  }

  /**
   * Generate nginx configuration for a domain
   */
  generateNginxConfig(domain) {
    const config = domain;
    let nginxConfig = '';

    if (config.type === 'static') {
      nginxConfig = `
server {
    listen 80;
    server_name ${config.domain};
    
    root ${config.target};
    index index.html index.htm;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
}`;
    } else if (config.type === 'server') {
      const [host, port] = config.target.split(':');
      nginxConfig = `
server {
    listen 80;
    server_name ${config.domain};
    
    location / {
        proxy_pass http://${host}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}`;
    }

    // Add SSL configuration if enabled
    if (config.sslMode === 'letsencrypt') {
      nginxConfig += `

server {
    listen 443 ssl http2;
    server_name ${config.domain};
    
    ssl_certificate ${config.sslCertificate};
    ssl_certificate_key ${config.sslCertificateKey};
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    ${config.type === 'static' ? `
    root ${config.target};
    index index.html index.htm;
    
    location / {
        try_files $uri $uri/ /index.html;
    }` : `
    location / {
        proxy_pass http://${config.target};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }`}
}`;
    }

    return nginxConfig;
  }

  /**
   * Update nginx configurations
   */
  async updateNginxConfigs(domains) {
    try {
      const results = [];

      for (const domain of domains) {
        const configContent = this.generateNginxConfig(domain);
        const configPath = path.join(this.nginxConfigPath, domain.domain);
        const enabledPath = path.join(this.nginxEnabledPath, domain.domain);

        // Write nginx config
        await fs.writeFile(configPath, configContent);

        // Enable site by creating symlink
        try {
          await fs.unlink(enabledPath);
        } catch (error) {
          // File might not exist
        }
        
        await fs.symlink(configPath, enabledPath);

        results.push({
          domain: domain.domain,
          configPath,
          status: 'updated'
        });
      }

      // Test nginx configuration
      try {
        execSync('nginx -t');
        execSync('systemctl reload nginx');
        
        return {
          message: `Updated nginx configurations for ${results.length} domains`,
          results,
          nginxReloaded: true
        };
      } catch (error) {
        throw new Error(`Nginx configuration test failed: ${error.message}`);
      }

    } catch (error) {
      throw new Error(`Failed to update nginx configs: ${error.message}`);
    }
  }

  /**
   * Get current domain configurations
   */
  async getDomainConfigs() {
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

      db.all(query, [], (err, rows) => {
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
  async healthCheck() {
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
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}
