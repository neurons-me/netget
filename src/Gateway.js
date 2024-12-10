// netget/src/gateway.js
import express from 'express';
import path from 'path';
import morgan from 'morgan';
import { Server } from 'socket.io';
import http from 'http';
import defaultRoutes from './routes/defaultRoutes.js';
import { fileURLToPath } from 'url';
import fs from 'fs';
import chalk from 'chalk';
// Determine the base directory for static file serving and view engine setup
const baseDir = path.dirname(fileURLToPath(import.meta.url));

class Gateway {
  constructor({
    host = process.env.HOST || 'localhost',
    port = process.env.NETGET_PORT || 3432,
    routes = {},
    domainsConfigPath = process.env.DOMAINS_CONFIG_PATH || '~/.get/domains.json'
  } = {}) {
    this.host = host;
    this.port = port;
    this.routes = routes;
    this.domainsConfigPath = domainsConfigPath;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server);
    this.initialize().catch(err => console.error('Initialization error:', err));
  }

  async initialize() {
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());
    this.app.use(express.static(path.join(baseDir, 'ejsApp', 'public')));
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(baseDir, 'ejsApp', 'views'));
      if (fs.existsSync(this.domainsConfigPath)) {
        console.error(chalk.yellow(
        'Domains Configuration File Not Found.',
        '\n',
        'Please provide a valid path @ .env Line DOMAINS_CONFIG_PATH=...'));
        //process.exit(1); // Exit if the configuration file doesn't exist
      }

    if (!fs.existsSync(this.domainsConfigPath)) {
      console.error(chalk.yellow('Domains Configuration File Not Found.',
      '\n', 'Please provide a valid path @ .env Line DOMAINS_CONFIG_PATH=...'));
    }

    morgan.token('host', (req) => req.hostname || req.headers['host'] || '-');
    this.app.use(morgan(':method :url :status :res[content-length] - :response-time ms - Host: :host', {
      stream: {
        write: (message) => {
          this.io.emit('log', message); // Emit log message to connected clients
        }
      }
    }));

    this.app.use((req, res) => {
      const fullUrl = `${req.hostname || req.headers['host']}${req.url}`;
      let handler = null;

      Object.keys(this.routes).some(pattern => {
        const regexPattern = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        if (regexPattern.test(fullUrl)) {
          handler = this.routes[pattern];
          return true;
        }
        return false;
      });

      if (!handler) {
        const hostname = req.hostname || req.headers['host'];
        Object.keys(this.routes).some(pattern => {
          if (pattern === hostname) {
            handler = this.routes[pattern];
            return true;
          } else if (pattern.startsWith('*.')) {
            const baseDomain = pattern.slice(2);
            if (hostname.endsWith(baseDomain) && (hostname.split('.').length === baseDomain.split('.').length + 1)) {
              handler = this.routes[pattern];
              return true;
            }
          }
          return false;
        });
      }

      handler = handler || defaultRoutes;
      handler(req, res);
    });

    this.io.on('connection', (socket) => {
      console.log('New client connected');
      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });
    });
  }

  listen() {
    this.server.listen(this.port, this.host, () => {
      console.log(chalk.green(`Gateway listening at http://${this.host}:${this.port}`));
    });
  }
}

export default Gateway;
