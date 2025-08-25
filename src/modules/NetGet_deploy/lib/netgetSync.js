import fs from 'fs/promises';
import sqlite3 from 'sqlite3';
import axios from 'axios';
import FormData from 'form-data';
import archiver from 'archiver';
import path from 'path';
import { promisify } from 'util';

export class NetGetSync {
  constructor(config) {
    this.localDbPath = config.localDbPath;
    this.remoteServer = config.remoteServer;
    this.remoteApiKey = config.remoteApiKey;
    this.projectsBasePath = config.projectsBasePath;
  }

  /**
   * Read local NetGet configuration from SQLite database
   */
  async readLocalConfig() {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.localDbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(new Error(`Failed to open local database: ${err.message}`));
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
   * Package project files for deployment
   */
  async packageProject(projectPath, domain) {
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const zipPath = path.join(tempDir, `${domain}.zip`);
    
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(`✓ Project packaged: ${archive.pointer()} bytes`);
        resolve(zipPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add project files to archive (exclude node_modules, .git, etc.)
      archive.glob('**/*', {
        cwd: projectPath,
        ignore: [
          'node_modules/**',
          '.git/**',
          '.env',
          '*.log',
          'dist/**',
          'build/**',
          '.DS_Store'
        ]
      });

      archive.finalize();
    });
  }

  /**
   * Sync domain configuration to remote server
   */
  async syncDomainConfig(domains) {
    try {
      const response = await axios.post(`${this.remoteServer}/api/sync/domains`, {
        domains: domains,
        timestamp: Date.now()
      }, {
        headers: {
          'Authorization': `Bearer ${this.remoteApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to sync domain config: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Deploy project files to remote server
   */
  async deployProject(domain, zipPath) {
    try {
      const form = new FormData();
      form.append('domain', domain);
      form.append('file', fs.createReadStream(zipPath));

      const response = await axios.post(`${this.remoteServer}/api/sync/deploy`, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.remoteApiKey}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000 // 5 minutes
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to deploy project: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Check remote server health
   */
  async checkRemoteHealth() {
    try {
      const response = await axios.get(`${this.remoteServer}/api/health`, {
        headers: {
          'Authorization': `Bearer ${this.remoteApiKey}`
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      throw new Error(`Remote server not accessible: ${error.message}`);
    }
  }

  /**
   * Main sync process
   */
  async sync(options = {}) {
    const { includeProjects = false, domains: specificDomains = null } = options;
    
    console.log('🚀 Starting NetGet sync process...\n');

    try {
      // 1. Check remote server health
      console.log('1. Checking remote server health...');
      await this.checkRemoteHealth();
      console.log('✓ Remote server is accessible\n');

      // 2. Read local configuration
      console.log('2. Reading local NetGet configuration...');
      const allDomains = await this.readLocalConfig();
      
      // Filter domains if specific domains are requested
      const domainsToSync = specificDomains 
        ? allDomains.filter(d => specificDomains.includes(d.domain))
        : allDomains;

      console.log(`✓ Found ${domainsToSync.length} domains to sync\n`);

      // 3. Sync domain configurations
      console.log('3. Syncing domain configurations...');
      const syncResult = await this.syncDomainConfig(domainsToSync);
      console.log(`✓ Configuration synced: ${syncResult.message}\n`);

      // 4. Deploy projects if requested
      if (includeProjects) {
        console.log('4. Deploying project files...');
        
        for (const domain of domainsToSync) {
          if (domain.projectPath && domain.type !== 'redirect') {
            try {
              console.log(`   📦 Packaging ${domain.domain}...`);
              const zipPath = await this.packageProject(domain.projectPath, domain.domain);
              
              console.log(`   🚀 Deploying ${domain.domain}...`);
              await this.deployProject(domain.domain, zipPath);
              
              // Clean up temp file
              await fs.unlink(zipPath);
              
              console.log(`   ✓ ${domain.domain} deployed successfully`);
            } catch (error) {
              console.log(`   ❌ Failed to deploy ${domain.domain}: ${error.message}`);
            }
          }
        }
        console.log('');
      }

      console.log('🎉 NetGet sync completed successfully!');
      
      return {
        success: true,
        syncedDomains: domainsToSync.length,
        message: 'Sync completed successfully'
      };

    } catch (error) {
      console.error(`❌ Sync failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Compare local and remote configurations
   */
  async compare() {
    try {
      console.log('🔍 Comparing local and remote configurations...\n');

      // Get local config
      const localDomains = await this.readLocalConfig();
      
      // Get remote config
      const response = await axios.get(`${this.remoteServer}/api/sync/domains`, {
        headers: {
          'Authorization': `Bearer ${this.remoteApiKey}`
        }
      });

      const remoteDomains = response.data.domains;

      // Compare
      const localDomainNames = new Set(localDomains.map(d => d.domain));
      const remoteDomainNames = new Set(remoteDomains.map(d => d.domain));

      const onlyLocal = localDomains.filter(d => !remoteDomainNames.has(d.domain));
      const onlyRemote = remoteDomains.filter(d => !localDomainNames.has(d.domain));
      const common = localDomains.filter(d => remoteDomainNames.has(d.domain));

      console.log(`📊 Comparison Results:`);
      console.log(`   Local domains: ${localDomains.length}`);
      console.log(`   Remote domains: ${remoteDomains.length}`);
      console.log(`   Only in local: ${onlyLocal.length}`);
      console.log(`   Only in remote: ${onlyRemote.length}`);
      console.log(`   Common: ${common.length}\n`);

      if (onlyLocal.length > 0) {
        console.log('🔸 Domains only in local:');
        onlyLocal.forEach(d => console.log(`   - ${d.domain}`));
        console.log('');
      }

      if (onlyRemote.length > 0) {
        console.log('🔹 Domains only in remote:');
        onlyRemote.forEach(d => console.log(`   - ${d.domain}`));
        console.log('');
      }

      return {
        local: localDomains,
        remote: remoteDomains,
        onlyLocal,
        onlyRemote,
        common
      };

    } catch (error) {
      throw new Error(`Failed to compare configurations: ${error.message}`);
    }
  }
}
