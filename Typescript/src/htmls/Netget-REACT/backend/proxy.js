import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenvFlow from 'dotenv-flow';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import localNetgetRoutes from './routes/localNetget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, 'env');

dotenvFlow.config({
    path: envPath,
    pattern: '.env[.node_env]',
    default_node_env: 'development'
});

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// local.netget is loopback-only — nginx enforces this at the network level.
// No auth layer needed in the GUI backend itself.
app.use(bodyParser.json());
app.use(cors({
    origin: function (origin, callback) {
        // Allow local origins and same-origin requests
        const allowed = !origin
            || origin.includes('local.netget')
            || origin.includes('localhost')
            || origin.includes('127.0.0.1');
        if (allowed) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
}));

app.use('/', localNetgetRoutes);

app.listen(PORT, '127.0.0.1', () => {
    console.log(chalk.green(`NetGet local GUI backend on port ${PORT} (${NODE_ENV})`));
});

// ─── Log parsing utilities (used by localNetget.js /logs route) ──────────────

export function parseLogLine(line, index, logStructure) {
    try {
        switch (logStructure) {
            case 'nginx_access':  return parseNginxAccessLog(line, index);
            case 'nginx_error':   return parseNginxErrorLog(line, index);
            case 'server':        return parseServerLog(line, index);
            default:              return null;
        }
    } catch {
        return { id: index, timestamp: new Date().toISOString(), level: 'UNKNOWN', message: line, fullLine: line, parsed: false };
    }
}

function parseNginxAccessLog(line, index) {
    const re = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
    const m = line.match(re);
    if (m) {
        const [, ip, ts, req, status, size, referer, ua] = m;
        const [method, reqPath = ''] = req.split(' ');
        return {
            id: index, timestamp: convertNginxTimestamp(ts), level: statusLevel(+status),
            method, path: decodeURIComponent(reqPath).substring(0, 500),
            status: +status, size: +size, ip: ip !== '-' ? ip : null,
            userAgent: ua !== '-' ? ua.substring(0, 150) : null,
            referer: referer !== '-' ? referer.substring(0, 200) : null,
            message: `${method} ${reqPath} - ${status}`,
            fullLine: line, parsed: true, logType: 'access',
        };
    }
    return { id: index, timestamp: new Date().toISOString(), level: 'INFO', message: line, fullLine: line, parsed: false, logType: 'access' };
}

function parseNginxErrorLog(line, index) {
    const re = /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(\d+)#(\d+):\s*(.*)/;
    const m = line.match(re);
    if (m) {
        const [, ts, level, pid, tid, message] = m;
        return { id: index, timestamp: convertNginxErrorTimestamp(ts), level: level.toUpperCase(), pid: +pid, tid: +tid, message, fullLine: line, parsed: true, logType: 'error' };
    }
    return { id: index, timestamp: new Date().toISOString(), level: 'ERROR', message: line, fullLine: line, parsed: false, logType: 'error' };
}

function parseServerLog(line, index) {
    const parts = line.split(' - ');
    if (parts.length >= 2) {
        const [ts, rest] = parts;
        const [method, p = ''] = rest.split(' ');
        return { id: index, timestamp: ts, level: 'INFO', method, path: p, message: `${method} ${p}`, fullLine: line, parsed: true, logType: 'server' };
    }
    return { id: index, timestamp: new Date().toISOString(), level: 'INFO', message: line, fullLine: line, parsed: false, logType: 'server' };
}

function convertNginxTimestamp(s) {
    try {
        const m = s.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return new Date().toISOString();
        const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
        return new Date(`${m[3]}-${months[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}.000Z`).toISOString();
    } catch { return new Date().toISOString(); }
}

function convertNginxErrorTimestamp(s) {
    try { return new Date(s.replace(/\//g, '-')).toISOString(); }
    catch { return new Date().toISOString(); }
}

function statusLevel(status) {
    if (status >= 500) return 'ERROR';
    if (status >= 400) return 'WARN';
    return 'INFO';
}
