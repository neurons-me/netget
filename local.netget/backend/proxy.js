import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import dotenvFlow from 'dotenv-flow';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import networksRoutes from './routes/networks.js';
import deployRoutes from './deploy_server.js'
import { getDomainsDbPath } from '../../src/utils/netgetPaths.js';

// Load environment variables
dotenvFlow.config({
    path: process.cwd() + '/local.netget/backend/env',
    pattern: '.env[.node_env]',
    default_node_env: 'development'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFilePath = path.join(__dirname, 'server.log');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').split(',');
const USE_HTTPS = process.env.USE_HTTPS;
const AUTHORIZED_KEYS = (process.env.AUTHORIZED_KEYS || '').split(',');
const PROJECTS_PATH = process.env.PROJECTS_PATH || '/var/www';

// Database configuration
const DB_PATH = process.env.DB_PATH || getDomainsDbPath();
const NGINX_LOGS_PATH = process.env.NGINX_LOGS_PATH || "/usr/local/openresty/nginx/logs";
const SERVER_LOG_PATH = process.env.SERVER_LOG_PATH || "./server.log";

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error(chalk.red("Error connecting to SQLite:", err.message));
  }
});

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
function verifyCookie(req, res, next) {
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

app.get("/healthcheck", (req, res) => {
    res.status(200).send("Server is online");
  });

app.get("/check-auth", (req, res) => {
    if (!req.cookies.token) {
        return res.json({ authenticated: false });
    }

    try {
        const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
        res.json({ authenticated: true, user: decoded });
    } catch (error) {
        console.error(chalk.red("Auth check failed:", error.message));
        res.json({ authenticated: false });
    }
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    // TODO: Replace with proper user authentication from database
    // This is a temporary implementation for development
    const validUsers = [
        { username: "admin", password: "orwell1984", role: "admin" },
        { username: "bren", password: "orwell1984", role: "user" }
    ];

    const user = validUsers.find((u) => u.username === username && u.password === password);

    if (user) {
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
        res.cookie("token", token, { 
            httpOnly: true, 
            secure: USE_HTTPS, 
            sameSite: USE_HTTPS ? "None" : "Lax",
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        return res.json({ success: true, user: { username, role: user.role } });
    }
    
    // Add a small delay to prevent brute force attacks
    setTimeout(() => {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }, 1000);
});

// Endpoint para obtener logs del servidor (nginx access y error logs)
app.get("/logs", verifyCookie, async (req, res) => {
    try {
        const logType = req.query.type || 'access'; // 'access' or 'error' or 'server'
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        
        let targetLogPath;
        let logStructure;
        
        switch (logType) {
            case 'access':
                targetLogPath = path.join(NGINX_LOGS_PATH, 'access.log');
                logStructure = 'nginx_access';
                break;
            case 'error':
                targetLogPath = path.join(NGINX_LOGS_PATH, 'error.log');
                logStructure = 'nginx_error';
                break;
            case 'server':
                targetLogPath = path.join(__dirname, SERVER_LOG_PATH);
                logStructure = 'server';
                break;
            default:
                return res.status(400).json({ error: "Invalid log type. Use 'access', 'error', or 'server'" });
        }
        
        if (!fs.existsSync(targetLogPath)) {
            return res.json({
                logs: [],
                total: 0,
                offset,
                limit,
                logType,
                message: `Log file not found: ${logType}`
            });
        }

        // Get file stats for large file handling
        const stats = fs.statSync(targetLogPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        
        // For very large files (>100MB), read from the end
        let logContent;
        if (fileSizeInMB > 100) {
            // Read last 1MB for large files to avoid memory issues
            const fd = fs.openSync(targetLogPath, 'r');
            const buffer = Buffer.alloc(1024 * 1024); // 1MB buffer
            const readPosition = Math.max(0, stats.size - (1024 * 1024));
            fs.readSync(fd, buffer, 0, buffer.length, readPosition);
            fs.closeSync(fd);
            logContent = buffer.toString('utf8');
        } else {
            logContent = fs.readFileSync(targetLogPath, 'utf8');
        }
        
        const logLines = logContent.trim().split('\n').filter(line => line.trim());
        
        // Parse log lines based on structure
        const logs = logLines
            .map((line, index) => {
                return parseLogLine(line, index, logStructure);
            })
            .filter(log => log !== null)
            .reverse() // Most recent first
            .slice(offset, offset + limit);

        res.json({
            logs,
            total: logLines.length,
            offset,
            limit,
            logType,
            fileSize: `${fileSizeInMB.toFixed(2)} MB`,
            truncated: fileSizeInMB > 100
        });
    } catch (error) {
        console.error("Error reading logs:", error);
        res.status(500).json({ error: "Failed to read server logs", details: error.message });
    }
});

// Helper function to parse different log formats
function parseLogLine(line, index, logStructure) {
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

// Endpoint para obtener dominios desde la base de datos
app.get("/domains", verifyCookie, async (req, res) => {
    const query = "SELECT domain, subdomain, email, sslMode, target, type, projectPath, owner FROM domains";

    try {
        // Fetch domains directly from the database
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error al obtener los dominios de la base de datos:", err.message);
                return res.status(500).json({ error: "Error al obtener los dominios de la base de datos" });
            }
            return res.json(rows);
        });
    } catch (error) {
        console.error("Error general al obtener los dominios:", error.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Endpoint to get subdomains for a specific parent domain
app.get("/domains/:parentDomain/subdomains", verifyCookie, async (req, res) => {
    const { parentDomain } = req.params;
    
    if (!parentDomain) {
        return res.status(400).json({ error: "Parent domain is required" });
    }

    const query = "SELECT domain, subdomain, email, sslMode, target, type, projectPath, owner FROM domains WHERE subdomain = ? AND domain != ?";

    try {
        db.all(query, [parentDomain, parentDomain], (err, rows) => {
            if (err) {
                console.error("Error fetching subdomains from database:", err.message);
                return res.status(500).json({ error: "Error fetching subdomains from database" });
            }
            return res.json(rows);
        });
    } catch (error) {
        console.error("General error fetching subdomains:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.put("/update-domain", verifyCookie, (req, res) => {
    const { domain, updatedFields } = req.body;

    if (!domain || !updatedFields) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const updates = Object.keys(updatedFields)
        .map((field) => `${field} = ?`)
        .join(", ");
    const values = [...Object.values(updatedFields), domain];

    const query = `UPDATE domains SET ${updates} WHERE domain = ?`;

    db.run(query, values, function (err) {
        if (err) {
            console.error("Error updating domain:", err.message);
            return res.status(500).json({ error: "Database update failed" });
        }

        res.json({ success: true, message: "Domain updated successfully" });
    });
});

// Health check endpoint
app.get("/healthcheck", (req, res) => {
    res.json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        service: "NetGet Instance",
        version: "1.0.0"
    });
});

app.post("/add-domain", verifyCookie, (req, res) => {
    const { domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner } = req.body;

    if (!domain || !email || !target || !owner) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if domain already exists
    db.get("SELECT domain FROM domains WHERE domain = ?", [domain], (err, existingDomain) => {
        if (err) {
            console.error("Error checking existing domain:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (existingDomain) {
            return res.status(409).json({ error: "Domain already exists" });
        }

        // Insert new domain
        const query = `INSERT INTO domains (domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [domain, subdomain || '', email, sslMode || 'letsencrypt', sslCertificate || '', sslCertificateKey || '', target, type || 'server', projectPath || '', owner];

        db.run(query, values, function (err) {
            if (err) {
                console.error("Error adding domain:", err.message);
                return res.status(500).json({ error: "Failed to add domain" });
            }

            res.json({ success: true, message: "Domain added successfully", domain: domain });
        });
    });
});

app.post("/logout", (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: USE_HTTPS,
        sameSite: USE_HTTPS ? "None" : "Lax"
    });
    return res.json({ success: true, message: "Logged out successfully" });
});

app.get('/test', (req, res) => {
    if (!req.cleaker || !req.cleaker.identity) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const identity = req.cleaker.identity;
    const context = req.cleaker.context;
    res.json({ 
        message: "Test endpoint",
        identity,
        context
    });
});

// Use networks routes
app.use('/networks', networksRoutes);
app.use('/deploy', deployRoutes);

app.listen(PORT, "0.0.0.0", () => {
    console.log('');
    console.log(chalk.blue(`Starting server in ${NODE_ENV} mode`));
    if (NODE_ENV === 'development') {
        console.log(chalk.yellow('Development mode - some security features may be relaxed'));
    }
    console.log(chalk.green(`Server running on port ${PORT}`));
    console.log(chalk.blue(`Environment: ${NODE_ENV}`));
    console.log(chalk.blue(`HTTPS: ${USE_HTTPS}`));
    console.log(chalk.blue(`Database: ${DB_PATH}`));
    console.log(chalk.blue(`Authorized Keys: ${AUTHORIZED_KEYS.join(', ')}`));
    console.log(chalk.blue(`Projects Path: ${PROJECTS_PATH}`));
});
