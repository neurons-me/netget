import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import dotenvFlow from 'dotenv-flow';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import networksRoutes from './routes/networks.js';
import deployRoutes from './deploy_server.js';
import localNetgetRoutes from './routes/localNetget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, 'env');

dotenvFlow.config({
    path: envPath,
    pattern: '.env[.node_env]',
    default_node_env: 'development'
});

if (dotenvFlow.config({
    path: envPath,
    pattern: '.env[.node_env]',
    default_node_env: 'development'
})) {
    console.log(chalk.green('Environment variables loaded successfully.'));
} else {
    console.error(chalk.red('Failed to load environment variables.'));
    console.log(chalk.blue('Loading environment variables...'));
    console.log(chalk.blue(`Current working directory: ${process.cwd()}`));
    console.log(chalk.blue(`Script directory: ${__dirname}`));

    console.log(chalk.blue(`Loading env from: ${envPath}`));
}

const logFilePath = path.join(__dirname, 'server.log');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || '';
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').split(',');
const USE_HTTPS = process.env.USE_HTTPS;
const AUTHORIZED_KEYS = (process.env.AUTHORIZED_KEYS || '').split(',');
const PROJECTS_PATH = process.env.PROJECTS_PATH || '/var/www';

// Database configuration
const DB_PATH = process.env.DB_PATH || getDomainsDbPath();
const NGINX_LOGS_PATH = process.env.NGINX_LOGS_PATH || "/usr/local/openresty/nginx/logs";
const SERVER_LOG_PATH = process.env.SERVER_LOG_PATH || "./server.log";

app.use(cookieParser());
app.use(bodyParser.json());
app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || CORS_ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                console.warn(chalk.yellow(`CORS blocked request from origin: ${origin}`));
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: "Content-Type, Authorization"
    })
);

// Configure the session middleware
app.use(
    session({
        secret: ENCRYPTION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: USE_HTTPS, // Use HTTPS setting from environment
            sameSite: USE_HTTPS ? "none" : "lax",
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        }
    })
);

app.options("*", (req, res) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(200);
});

// Middleware to verify the cookie
export function verifyCookie(req, res, next) {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ error: "Access denied. No token provided." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error(chalk.red("Token verification failed:", err.message));
        res.status(400).json({ error: "Invalid token." });
    }
}
// Helper function to parse different log formats
export function parseLogLine(line, index, logStructure) {
    try {
        switch (logStructure) {
            case 'nginx_access':
                return parseNginxAccessLog(line, index);
            case 'nginx_error':
                return parseNginxErrorLog(line, index);
            case 'server':
                return parseServerLog(line, index);
            default:
                return null;
        }
    } catch (error) {
        // If parsing fails, return a basic structure
        return {
            id: index,
            timestamp: new Date().toISOString(),
            level: 'UNKNOWN',
            message: line,
            fullLine: line,
            parsed: false
        };
    }
}

// Parse nginx access log format (Common Log Format + extensions)
function parseNginxAccessLog(line, index) {
    // Example: 192.168.1.1 - - [13/Aug/2025:19:14:30 +0000] "GET /api/domains HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0..."
    const accessLogRegex = /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
    const match = line.match(accessLogRegex);
    
    if (match) {
        const [, ip, , user, timestamp, request, status, size, referer, userAgent] = match;
        const requestParts = request.split(' ');
        const method = requestParts[0] || 'UNKNOWN';
        const path = requestParts[1] || '';
        
        // Sanitize user agent - remove potentially sensitive information.
        // Allow common user agent characters: alphanumerics, whitespace, dash, dot, parentheses, slash, semicolon, colon, comma, plus, equals, underscore, single/double quote, at, percent.
        const sanitizedUserAgent = userAgent && userAgent !== '-' 
            ? userAgent.substring(0, 150).replace(/[^\w\s\-.,;:\/\(\)\+\=\_\'\"\@\%]/g, '') 
            : null;
        
        return {
            id: index,
            timestamp: convertNginxTimestamp(timestamp),
            level: getStatusLevel(parseInt(status)),
            method: method,
            path: decodeURIComponent(path || '').substring(0, 500), // Limit path length
            status: parseInt(status),
            size: parseInt(size),
            ip: ip !== '-' ? ip : null,
            userAgent: sanitizedUserAgent,
            referer: referer && referer !== '-' ? referer.substring(0, 200) : null,
            message: `${method} ${path} - ${status} (${size} bytes)`,
            fullLine: line,
            parsed: true,
            logType: 'access'
        };
    }
    
    return {
        id: index,
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: line,
        fullLine: line,
        parsed: false,
        logType: 'access'
    };
}

// Parse nginx error log format
function parseNginxErrorLog(line, index) {
    // Example: 2025/08/13 19:14:30 [error] 1234#0: *5678 connect() failed (111: Connection refused)
    const errorLogRegex = /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(\d+)#(\d+):\s*(.*)/;
    const match = line.match(errorLogRegex);
    
    if (match) {
        const [, timestamp, level, pid, tid, message] = match;
        
        return {
            id: index,
            timestamp: convertNginxErrorTimestamp(timestamp),
            level: level.toUpperCase(),
            pid: parseInt(pid),
            tid: parseInt(tid),
            message: message,
            fullLine: line,
            parsed: true,
            logType: 'error'
        };
    }
    
    return {
        id: index,
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        message: line,
        fullLine: line,
        parsed: false,
        logType: 'error'
    };
}

// Parse server log format (existing format)
function parseServerLog(line, index) {
    const parts = line.split(' - ');
    if (parts.length >= 2) {
        const timestamp = parts[0];
        const method_path = parts[1].split(' ');
        const method = method_path[0] || 'UNKNOWN';
        const path = method_path[1] || '';
        
        return {
            id: index,
            timestamp,
            level: getLogLevel(method),
            method,
            path,
            message: `${method} ${path}`,
            fullLine: line,
            parsed: true,
            logType: 'server'
        };
    }
    
    return {
        id: index,
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: line,
        fullLine: line,
        parsed: false,
        logType: 'server'
    };
}

// Convert nginx access log timestamp to ISO format
function convertNginxTimestamp(nginxTimestamp) {
    try {
        // Convert "13/Aug/2025:19:14:30 +0000" to ISO format
        const match = nginxTimestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([\+\-]\d{4})/);
        if (match) {
            const [, day, monthStr, year, hour, minute, second, timezone] = match;
            const months = {
                'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
            };
            const month = months[monthStr] || '01';
            const isoDate = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
            return new Date(isoDate).toISOString();
        }
        return new Date().toISOString();
    } catch (error) {
        return new Date().toISOString();
    }
}

// Convert nginx error log timestamp to ISO format  
function convertNginxErrorTimestamp(nginxTimestamp) {
    try {
        // Convert "2025/08/13 19:14:30" to ISO format
        const date = new Date(nginxTimestamp.replace(/\//g, '-'));
        return date.toISOString();
    } catch (error) {
        return new Date().toISOString();
    }
}

// Get log level based on HTTP status code
function getStatusLevel(status) {
    if (status >= 500) return 'ERROR';
    if (status >= 400) return 'WARN';
    if (status >= 300) return 'INFO';
    if (status >= 200) return 'INFO';
    return 'DEBUG';
}

// Helper function to determine log level based on HTTP method
function getLogLevel(method) {
    switch (method) {
        case 'GET':
            return 'INFO';
        case 'POST':
            return 'INFO';
        case 'PUT':
            return 'WARN';
        case 'DELETE':
            return 'WARN';
        case 'OPTIONS':
            return 'DEBUG';
        default:
            return 'INFO';
    }
}

// Use networks routes
app.use('/networks', networksRoutes);
app.use('/deploy', deployRoutes);
app.use('/', localNetgetRoutes);

app.listen(PORT, "0.0.0.0", () => {
    console.log('');
    console.log(chalk.blue(`Starting server in ${NODE_ENV} mode`));
    if (NODE_ENV === 'development') {
        console.log(chalk.yellow('Development mode - some security features may be relaxed'));
        console.log(chalk.green(`Server running on port ${PORT}`));
        console.log(chalk.blue(`Environment: ${NODE_ENV}`));
        console.log(chalk.blue(`HTTPS: ${USE_HTTPS}`));
        console.log(chalk.blue(`Database: ${DB_PATH}`));
        console.log(chalk.blue(`Authorized Keys: ${AUTHORIZED_KEYS.join(', ')}`));
        console.log(chalk.blue(`Projects Path: ${PROJECTS_PATH}`));
    }
});
