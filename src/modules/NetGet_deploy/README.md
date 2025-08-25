# NetGet Deploy v2.0

A comprehensive deployment and synchronization tool for NetGet infrastructure. This tool enables seamless synchronization of NetGet configurations, domains, and applications between local development environments and remote production servers.

## Features

- **Domain Synchronization**: Sync domains and SSL certificates between NetGet instances
- **Project Deployment**: Upload and deploy complete NetGet projects to remote servers
- **Configuration Management**: Sync SQLite database configurations and nginx settings
- **Health Monitoring**: Monitor deployment status and server health
- **CLI Interface**: Easy-to-use command-line interface for all operations
- **REST API**: Complete API server for remote deployment operations

## Installation

```bash
npm install
```

## Configuration

Create a `deploy.config.json` file in your project root:

```json
{
  "remoteServers": [
    {
      "name": "production",
      "url": "https://your-remote-server.com",
      "apiKey": "your-api-key",
      "description": "Production NetGet server"
    }
  ],
  "localNetGetPath": "/path/to/your/local/netget",
  "syncOptions": {
    "includeDomains": true,
    "includeProjects": true,
    "backupBeforeSync": true
  }
}
```

Set environment variables:

```bash
export NETGET_API_KEY="your-secure-api-key"
export NETGET_PORT=3001
export NETGET_DB_PATH="/path/to/netget.db"
```

## CLI Usage

### Initialize Configuration

```bash
# Initialize deployment configuration
./cli.js init

# Validate current configuration
./cli.js validate
```

### Domain Operations

```bash
# Sync domains to remote server
./cli.js sync domains --server production

# Compare local and remote domains
./cli.js compare domains --server production

# Get sync status for a specific domain
./cli.js status example.com --server production
```

### Project Deployment

```bash
# Deploy a specific project
./cli.js sync project --name my-app --server production

# Deploy all projects
./cli.js sync all --server production

# Dry run (preview changes without applying)
./cli.js sync domains --server production --dry-run
```

### Monitoring

```bash
# Check server health
./cli.js status --server production

# Get detailed sync status
./cli.js status --verbose
```

## API Server

Start the remote API server:

```bash
npm start
# or for development
npm run dev
```

### API Endpoints

#### Health Check
```
GET /api/health
```

#### Domain Synchronization
```
GET /api/sync/domains
POST /api/sync/domains
```

#### Project Deployment
```
POST /api/sync/deploy
```

#### Status Monitoring
```
GET /api/sync/status/:domain
```

All endpoints require Bearer token authentication:
```
Authorization: Bearer YOUR_API_KEY
```

## Project Structure

```
NetGet_deploy/
├── cli.js                 # Command-line interface
├── server.js              # Express API server
├── lib/
│   ├── netgetSync.js      # Local sync operations
│   └── remoteDeployer.js  # Remote deployment logic
├── package.json
├── deploy.config.json     # Configuration file
└── README.md
```

## Development Workflow

### Local Development Setup

1. **Configure Local NetGet**: Ensure your local NetGet instance is properly configured
2. **Create Deploy Config**: Set up `deploy.config.json` with your remote servers
3. **Test Connection**: Use `./cli.js validate` to verify configuration
4. **Sync Domains**: Start with `./cli.js sync domains --dry-run` to preview changes

### Remote Server Setup

1. **Install Dependencies**: Run `npm install` on remote server
2. **Configure Environment**: Set `NETGET_API_KEY` and other environment variables
3. **Start API Server**: Run `npm start` to start the deployment API
4. **Verify Health**: Check `/api/health` endpoint

### Deployment Process

1. **Local Changes**: Make changes to your local NetGet configuration
2. **Compare**: Use `./cli.js compare` to see differences
3. **Sync**: Deploy changes with `./cli.js sync`
4. **Monitor**: Check status with `./cli.js status`

## Security Considerations

- **API Keys**: Use strong, unique API keys for each server
- **HTTPS**: Always use HTTPS for remote connections
- **File Permissions**: Ensure proper file permissions on uploaded projects
- **Backup**: Always backup before major deployments

## Error Handling

The tool provides comprehensive error handling:

- **Network Errors**: Automatic retry with exponential backoff
- **Authentication Failures**: Clear error messages and retry prompts
- **File System Errors**: Detailed error reporting with suggested fixes
- **Database Errors**: SQLite connection and query error handling

## Logging

All operations are logged with different levels:

- **Info**: General operation status
- **Warn**: Non-critical issues
- **Error**: Critical failures requiring attention
- **Debug**: Detailed debugging information (use `--verbose`)

## Examples

### Complete Domain Sync

```bash
# 1. Check current status
./cli.js status --server production

# 2. Compare local vs remote
./cli.js compare domains --server production

# 3. Sync domains
./cli.js sync domains --server production

# 4. Verify deployment
./cli.js status example.com --server production
```

### Project Deployment

```bash
# Deploy specific project
./cli.js sync project --name my-web-app --server production

# Deploy with custom options
./cli.js sync all --server production --backup --force
```

### Monitoring and Health Checks

```bash
# Quick health check
./cli.js status --server production

# Detailed status with all domains
./cli.js status --verbose --server production

# Check specific domain status
./cli.js status my-domain.com --server production
```

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify API key in environment variables
   - Check server configuration

2. **Database Connection Error**
   - Verify NetGet database path
   - Check file permissions

3. **Network Timeout**
   - Check internet connectivity
   - Verify server URL and port

4. **File Upload Failed**
   - Check available disk space
   - Verify file permissions

### Debug Mode

Use the `--verbose` flag for detailed debugging:

```bash
./cli.js sync domains --server production --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and support:
- Check the troubleshooting section
- Review error logs with `--verbose`
- Submit issues to the project repository
