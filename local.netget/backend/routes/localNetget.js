import express from "express";
import dotenvFlow from "dotenv-flow";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import jwt from "jsonwebtoken";
import chalk from "chalk";

import { fileURLToPath } from "url";
import { verifyCookie, parseLogLine } from "../proxy.js";
import { getPublicIP, getLocalIP } from "../../../src/modules/utils/ipUtils.ts";

// Load environment variables
dotenvFlow.config({
    path: process.cwd() + '/env',
    pattern: '.env[.node_env]',
    default_node_env: 'development'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET;
const USE_HTTPS = process.env.USE_HTTPS;

// Database configuration
const DB_PATH = process.env.DB_PATH || "/opt/.get/domains.db";
const NGINX_LOGS_PATH = process.env.NGINX_LOGS_PATH || "/usr/local/openresty/nginx/logs";
const SERVER_LOG_PATH = process.env.SERVER_LOG_PATH || "./server.log";

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error(chalk.red("Error connecting to SQLite:", err.message));
  }
});

const router = express.Router();

router.get("/check-auth", (req, res) => {
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

router.post("/login", (req, res) => {
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
router.get("/logs", verifyCookie, async (req, res) => {
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

// Endpoint para obtener dominios desde la base de datos
router.get("/domains", verifyCookie, async (req, res) => {
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
router.get("/domains/:parentDomain/subdomains", verifyCookie, async (req, res) => {
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

router.put("/update-domain", verifyCookie, (req, res) => {
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
router.get("/healthcheck", (req, res) => {
    res.json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        service: "NetGet Instance",
        version: "1.0.0"
    });
});

router.post("/add-domain", verifyCookie, (req, res) => {
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

router.post("/logout", (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: USE_HTTPS,
        sameSite: USE_HTTPS ? "None" : "Lax"
    });
    return res.json({ success: true, message: "Logged out successfully" });
});

router.get('/test', (req, res) => {
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

// IP information endpoint
router.get('/ip-info', async (req, res) => {
    try {
        const [publicIP, localIP] = await Promise.all([
            getPublicIP(),
            Promise.resolve(getLocalIP())
        ]);
        
        res.json({
            success: true,
            publicIP: publicIP || 'Not available',
            localIP: localIP || 'Not available'
        });
    } catch (error) {
        console.error('Error getting IP information:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve IP information',
            publicIP: 'Error',
            localIP: 'Error'
        });
    }
});

router.get('/port-info', (req, res) => {
    const backendPort = process.env.LOCAL_BACKEND_PORT || 3001;
    res.json({
        success: true,
        port: backendPort
    });
});

export default router; 