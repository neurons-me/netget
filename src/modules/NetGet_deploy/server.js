import express from 'express';
import multer from 'multer';
import { RemoteDeployer } from './lib/remoteDeployer.js';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = process.env.PORT || 3005;

// Configuration
const config = {
  dbPath: process.env.DB_PATH || '/opt/.get/domains.db',
  projectsBasePath: process.env.PROJECTS_PATH || '/var/www',
  nginxConfigPath: process.env.NGINX_CONFIG_PATH || '/etc/nginx/sites-available',
  nginxEnabledPath: process.env.NGINX_ENABLED_PATH || '/etc/nginx/sites-enabled',
  authorizedKeys: (process.env.AUTHORIZED_KEYS || '').split(',').filter(k => k.trim())
};

const deployer = new RemoteDeployer(config);

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
  if (!deployer.verifyApiKey(apiKey)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
};

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Health check endpoint
app.get('/api/health', authenticate, async (req, res) => {
  try {
    const health = await deployer.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      error: 'Health check failed',
      message: error.message
    });
  }
});

// Get current domain configurations
app.get('/api/sync/domains', authenticate, async (req, res) => {
  try {
    const domains = await deployer.getDomainConfigs();
    res.json({
      domains,
      count: domains.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve domain configurations',
      message: error.message
    });
  }
});

// Sync domain configurations
app.post('/api/sync/domains', authenticate, async (req, res) => {
  try {
    const { domains } = req.body;

    if (!domains || !Array.isArray(domains)) {
      return res.status(400).json({
        error: 'Invalid request: domains array is required'
      });
    }

    // Update database
    const dbResult = await deployer.updateDomainConfigs(domains);

    // Update nginx configurations
    const nginxResult = await deployer.updateNginxConfigs(domains);

    res.json({
      message: 'Domain configurations synced successfully',
      database: dbResult,
      nginx: nginxResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      error: 'Failed to sync domain configurations',
      message: error.message
    });
  }
});

// Deploy project files
app.post('/api/sync/deploy', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { domain } = req.body;
    const file = req.file;

    if (!domain) {
      return res.status(400).json({
        error: 'Domain parameter is required'
      });
    }

    if (!file) {
      return res.status(400).json({
        error: 'Project file is required'
      });
    }

    // Read uploaded file
    const fileBuffer = await fs.readFile(file.path);

    // Deploy project
    const result = await deployer.deployProject(domain, fileBuffer);

    // Clean up uploaded file
    await fs.unlink(file.path).catch(() => {}); // Ignore cleanup errors

    res.json({
      message: `Project deployed successfully for domain: ${domain}`,
      deployment: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Deploy error:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({
      error: 'Failed to deploy project',
      message: error.message
    });
  }
});

// Get deployment status for a domain
app.get('/api/sync/status/:domain', authenticate, async (req, res) => {
  try {
    const { domain } = req.params;
    
    // Get domain config from database
    const domains = await deployer.getDomainConfigs();
    const domainConfig = domains.find(d => d.domain === domain);

    if (!domainConfig) {
      return res.status(404).json({
        error: 'Domain not found'
      });
    }

    // Check if project files exist
    const projectPath = path.join(deployer.projectsBasePath, domain, 'current');
    let projectExists = false;
    try {
      await fs.access(projectPath);
      projectExists = true;
    } catch (error) {
      // Project doesn't exist
    }

    // Check nginx config
    const nginxConfigPath = path.join(deployer.nginxConfigPath, domain);
    let nginxConfigExists = false;
    try {
      await fs.access(nginxConfigPath);
      nginxConfigExists = true;
    } catch (error) {
      // Nginx config doesn't exist
    }

    res.json({
      domain,
      config: domainConfig,
      projectDeployed: projectExists,
      nginxConfigured: nginxConfigExists,
      projectPath,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to get deployment status',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 NetGet Deploy Server running on port ${port}`);
  console.log(`📁 Projects path: ${config.projectsBasePath}`);
  console.log(`🗄️  Database path: ${config.dbPath}`);
  console.log(`⚙️  Nginx config path: ${config.nginxConfigPath}`);
  console.log(`🔐 Authorized keys: ${config.authorizedKeys.length} configured`);
});

export default app;
