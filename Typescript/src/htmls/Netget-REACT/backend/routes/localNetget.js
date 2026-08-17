/**
 * local.netget backend routes — .me kernel model
 *
 * All data comes from materialized runtime snapshots on disk.
 * No SQLite. No JWT. No re-derivation of identity.
 *
 * Trust:    nginx enforces loopback-only for local.netget — the caller IS the operator.
 * Identity: gateway-claims.json is the resolved state; we read it, never re-derive it.
 * Mesh:     apps.json is the live monad registry; we read and filter stale entries.
 */
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { execFile, execFileSync } from "child_process";
import { parseLogLine } from "../proxy.js";

const NGINX_LOGS_PATH = process.env.NGINX_LOGS_PATH || "/usr/local/openresty/nginx/logs";

function getNetgetDataDir() {
    return process.env.NETGET_DATA_DIR || path.join(os.homedir(), '.get');
}

function runtimePath(filename) {
    return path.join(getNetgetDataDir(), 'runtime', filename);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function firstExistingPath(paths) {
    return paths.find(filePath => fs.existsSync(filePath)) ?? paths[0];
}

// Same resolution order as resolve_netget_bin() in domains.lua: prefer a
// `netget` on PATH, fall back to `npx netget` (works from this monorepo).
function resolveNetgetBin() {
    try {
        const out = execFileSync("which", ["netget"], { encoding: "utf8" }).trim();
        if (out) return out;
    } catch {
        // not on PATH — fall through
    }
    return null;
}

// Runs `netget <args...>`, parses the last non-empty stdout line as JSON
// (the CLI's status/reload --json/stop commands each print exactly one JSON
// line). Rejects with a normalized { ok:false, message } shape on failure so
// callers never have to distinguish "spawn failed" from "command failed".
function runNetgetCommand(args) {
    return new Promise((resolve) => {
        const bin = resolveNetgetBin();
        const [cmd, cmdArgs] = bin ? [bin, args] : ["npx", ["netget", ...args]];
        execFile(cmd, cmdArgs, { timeout: 30000 }, (error, stdout) => {
            const lines = (stdout || "").split("\n").map(l => l.trim()).filter(Boolean);
            const lastLine = lines[lines.length - 1];
            try {
                const parsed = JSON.parse(lastLine);
                resolve(parsed);
            } catch {
                resolve({
                    ok: false,
                    message: error ? error.message : "netget command produced no parseable output",
                    raw: stdout,
                });
            }
        });
    });
}

const router = express.Router();

// ─── OpenResty gateway control ────────────────────────────────────────────────
// Status is read-only (port checks + launchctl/systemctl queries) — no sudo,
// safe to poll. Restart/stop shell out through `netget`'s own sudo path
// (openRestyService.ts runSudoShell) and will fail cleanly with a JSON error
// if this backend process has no passwordless sudo rule for the OpenResty
// binary/launchctl/systemctl commands — same constraint the interactive CLI
// menu already has, not something new introduced by this endpoint.
router.get("/openresty-status", async (req, res) => {
    const result = await runNetgetCommand(["status"]);
    res.status(result.ok ? 200 : 502).json(result);
});

router.post("/openresty-restart", async (req, res) => {
    const result = await runNetgetCommand(["reload", "--json"]);
    res.status(result.ok ? 200 : 502).json(result);
});

router.post("/openresty-stop", async (req, res) => {
    const result = await runNetgetCommand(["stop"]);
    res.status(result.ok ? 200 : 502).json(result);
});

// ─── Gateway identity ────────────────────────────────────────────────────────
// Reads the materialized claims snapshot — never calls .me at runtime.
router.get("/gateway-identity", (req, res) => {
    const claims = readJson(runtimePath('gateway-claims.json'));

    if (!claims) {
        return res.json({
            gatewayId: os.hostname(),
            owner: null,
            bootstrapped: false,
            adminCount: 0,
            scopes: [],
            version: null,
            updatedAt: null,
        });
    }

    const ownerScopes = claims.owner ? (claims.grants?.[claims.owner] ?? []) : [];

    return res.json({
        gatewayId: claims.gatewayId ?? os.hostname(),
        owner: claims.owner ?? null,
        bootstrapped: !!claims.owner,
        adminCount: Object.keys(claims.admins ?? {}).length,
        scopes: ownerScopes,
        version: claims.version ?? null,
        updatedAt: claims.updatedAt ?? null,
    });
});

// ─── Live monad mesh ─────────────────────────────────────────────────────────
// Reads apps.json and scrubs stale entries (mirrors scrub_dead_apps in apps.lua).
router.get("/apps", (req, res) => {
    const registry = readJson(runtimePath('apps.json'));

    if (!registry) {
        return res.json({ apps: [], count: 0, updatedAt: null });
    }

    const nowMs = Date.now();
    const liveApps = Object.values(registry.apps ?? {}).filter(app => {
        const ttl = typeof app.ttlMs === 'number' ? app.ttlMs : 45000;
        const lastSeen = typeof app.lastSeenMs === 'number' ? app.lastSeenMs : 0;
        return lastSeen > 0 && (nowMs - lastSeen) <= ttl;
    });

    return res.json({
        apps: liveApps,
        count: liveApps.length,
        updatedAt: registry.updatedAt ?? null,
    });
});

// ─── Nginx logs ──────────────────────────────────────────────────────────────
router.get("/logs", (req, res) => {
    try {
        const logType = req.query.type || 'access';
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        let targetLogPath, logStructure;
        if (logType === 'access') {
            targetLogPath = firstExistingPath([
                path.join(NGINX_LOGS_PATH, 'netget_access.log'),
                path.join(NGINX_LOGS_PATH, 'access.log'),
            ]);
            logStructure = 'nginx_access';
        } else if (logType === 'error') {
            targetLogPath = firstExistingPath([
                path.join(NGINX_LOGS_PATH, 'netget_error.log'),
                path.join(NGINX_LOGS_PATH, 'error.log'),
            ]);
            logStructure = 'nginx_error';
        } else {
            return res.status(400).json({ error: "Invalid log type. Use 'access' or 'error'." });
        }

        if (!fs.existsSync(targetLogPath)) {
            return res.json({ logs: [], total: 0, offset, limit, logType, message: 'Log file not found.' });
        }

        const stats = fs.statSync(targetLogPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        let logContent;

        if (fileSizeInMB > 100) {
            const fd = fs.openSync(targetLogPath, 'r');
            const buffer = Buffer.alloc(1024 * 1024);
            fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, stats.size - (1024 * 1024)));
            fs.closeSync(fd);
            logContent = buffer.toString('utf8');
        } else {
            logContent = fs.readFileSync(targetLogPath, 'utf8');
        }

        const lines = logContent.trim().split('\n').filter(l => l.trim());
        const logs = lines
            .map((l, i) => parseLogLine(l, i, logStructure))
            .filter(Boolean)
            .reverse()
            .slice(offset, offset + limit);

        res.json({ logs, total: lines.length, offset, limit, logType, fileSize: `${fileSizeInMB.toFixed(2)} MB`, truncated: fileSizeInMB > 100 });
    } catch (err) {
        res.status(500).json({ error: "Failed to read logs", details: err.message });
    }
});

// ─── Utilities ────────────────────────────────────────────────────────────────
router.get('/ip-info', (req, res) => {
    try {
        const interfaces = os.networkInterfaces();
        const localIP = Object.values(interfaces)
            .flat()
            .find(iface => iface && !iface.internal && iface.family === 'IPv4')?.address ?? 'Not available';
        res.json({ success: true, localIP });
    } catch {
        res.status(500).json({ success: false, error: 'Failed to retrieve IP information' });
    }
});

router.get('/port-info', (req, res) => {
    res.json({ success: true, port: process.env.LOCAL_BACKEND_PORT || 3001 });
});

router.get('/healthcheck', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'NetGet Local GUI' });
});

// ─── Gateway capability model (Phase 1 prototype) ──────────────────────────────
// See docs/GatewayCapabilityModel.md. This route is the narrow daemon surface
// decision 4 requires: nginx's me_sig.lua verifies the request's Ed25519
// proof (identity + payload-bound signature) and forwards the *result* —
// verified identity hash and granted scopes — as internal headers. This
// route is where the capability *decision* is made and audited; nginx/Lua
// never decides it. Deliberately narrow: only a domain's `description`, in a
// sidecar file separate from domains.db, so nothing this endpoint writes can
// change what a request to that domain actually resolves to.

function domainMetadataPath() {
    return runtimePath('domain-metadata.json');
}

function auditLogPath() {
    return runtimePath('audit.log');
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Append-only, one JSON object per line — never overwritten, matching the
// "record the audit event" half of the capability decision.
function appendAuditLog(entry) {
    try {
        const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n';
        fs.mkdirSync(path.dirname(auditLogPath()), { recursive: true });
        fs.appendFileSync(auditLogPath(), line, 'utf8');
    } catch {
        // Audit logging must never block the actual request outcome.
    }
}

router.post('/domains/metadata', (req, res) => {
    const identity = String(req.header('X-Netget-Identity') || '').trim();
    let scopes;
    try {
        scopes = JSON.parse(req.header('X-Netget-Scopes') || '[]');
    } catch {
        scopes = [];
    }
    if (!Array.isArray(scopes)) scopes = [];

    const body = req.body || {};
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
    const description = typeof body.description === 'string' ? body.description : '';
    const auditBase = { action: 'gateway:write:domain-metadata', identity, domain };

    // Identity absent means nginx didn't verify a proof for this request at
    // all (e.g. hit directly, bypassing the /domains/metadata location) —
    // reject rather than silently treat as anonymous-but-capable.
    if (!identity) {
        appendAuditLog({ ...auditBase, outcome: 'denied', reason: 'no verified identity forwarded' });
        return res.status(401).json({ ok: false, error: 'IDENTITY_REQUIRED' });
    }
    if (!domain) {
        return res.status(400).json({ ok: false, error: 'domain is required' });
    }

    // The capability decision: being a verified identity (A — can decrypt/
    // authenticate) is not being granted this write (C). Two different
    // checks, on purpose — this is the boundary the whole model exists to
    // keep from collapsing.
    if (!scopes.includes('gateway:write:domain-metadata')) {
        appendAuditLog({ ...auditBase, outcome: 'denied', reason: 'missing gateway:write:domain-metadata scope', scopes });
        return res.status(403).json({ ok: false, error: 'CAPABILITY_DENIED', required: 'gateway:write:domain-metadata' });
    }

    const metadata = readJson(domainMetadataPath()) || {};
    metadata[domain] = { description, updatedBy: identity, updatedAt: new Date().toISOString() };
    writeJson(domainMetadataPath(), metadata);

    appendAuditLog({ ...auditBase, outcome: 'allowed', description });
    return res.json({ ok: true, domain, description });
});

export default router;
