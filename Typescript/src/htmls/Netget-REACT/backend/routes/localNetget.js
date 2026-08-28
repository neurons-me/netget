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
import {
    getDomains,
    getDomainByName,
    registerDomain,
    updateDomain,
    deleteDomain,
    sanitizeOwnerLabel,
} from "../../../../kernel/domainStore.ts";
import { getNetgetMonadOrigin, getGatewayRootNamespace } from "../../../../kernel/netgetMonadProcess.ts";
import { resolveSurface } from "../../../../kernel/topologyResolver.ts";
import { loadOrCreateXConfig } from "../../../../modules/NetGetX/config/xConfig.ts";

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

// ─── cleaker identity-handle resolution (local.cleaker/@handle) ──────────────
// Path form, not subdomain — matches the convention this.gui's
// useCleakerAuth.ts already uses against the machine's own hostname
// (`https://${hostname}/@${username}/`, "mDNS only resolves the machine
// hostname, not subdomains") and that monad's own resolveChainNamespace()/
// getAtSelectorFromPath() (modules/monad/Typescript/src/http/namespace.ts)
// already parse. A subdomain form (<handle>.local.cleaker, this route's
// first cut) tested fine under curl's Host-header override but isn't
// reachable by a real browser/phone at all — /etc/hosts has no wildcard
// syntax, only one static entry per host is possible, and per-handle
// entries don't scale or travel to another device scanning a QR.
//
// Two shapes:
//   GET /@handle         → identity + surface JSON (unchanged from before)
//   GET /@handle/<path>  → proxied read through to the resolved surface,
//                          reusing monad's already-correct disclosure
//                          envelope (public/closed/404, pathResolver.ts)
//                          as-is. No new classification logic here, this
//                          is a plain reverse-proxy hop.
//
// The upstream shape is NOT "GET /@handle/<path>" on the monad — tested
// that directly first and it hits the ledger/blockchain-history endpoint
// instead (same response for a real path and a made-up one, not a
// disclosure envelope at all). The real shape monad's own path resolver
// expects: the handle goes in X-Forwarded-Host as the full canonical
// namespace (so namespaceToKernelPrefix() composes users.<handle>
// server-side), and the URL path is just the field path relative to that
// user's own tree — confirmed live: GET /domains.x.target with
// x-forwarded-host: netget.local.cleaker returns
// {"disclosure":"public","value":...}; a made-up path correctly 404s.
// Writes are deliberately NOT proxied here — they go through the existing,
// separately-protected monad write path (isNamespaceWriteAuthorized),
// untouched by this route.
//
// nginx's "location ~ ^/@" is what routes here (see
// setNginxConfigRoutes.ts) — the admin block's bare "/" is a static
// try_files location serving index.html straight from disk, which never
// reaches Express at all, so /@handle needed its own explicit location the
// same way /cleaker/resolve did.
router.use((req, res, next) => {
    const match = req.path.match(/^\/@([^/]+)(\/.*)?$/);
    if (!match) return next();
    if (req.method !== "GET") {
        return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const handle = sanitizeOwnerLabel(match[1]);
    const subPath = match[2] && match[2] !== "/" ? match[2] : "";
    const canonicalNamespace = `${handle}.${getGatewayRootNamespace()}`;

    if (!subPath) {
        resolveSurface({ namespace: canonicalNamespace })
            .then((surface) => {
                res.json({
                    ok: true,
                    handle,
                    namespace: canonicalNamespace,
                    semanticPath: `users.${handle}`,
                    surface: surface || null,
                });
            })
            .catch((error) => {
                res.status(500).json({ ok: false, error: "RESOLVE_FAILED", detail: String(error?.message || error) });
            });
        return;
    }

    resolveSurface({ namespace: canonicalNamespace })
        .then(async (surface) => {
            if (!surface?.url) {
                return res.status(404).json({ ok: false, error: "SURFACE_NOT_FOUND" });
            }
            const upstream = await fetch(`${surface.url}${subPath}`, {
                method: "GET",
                headers: {
                    accept: "application/json",
                    "x-forwarded-host": canonicalNamespace,
                },
            });
            const payload = await upstream.json().catch(() => ({}));
            res.status(upstream.status).json(payload);
        })
        .catch((error) => {
            res.status(502).json({ ok: false, error: "SURFACE_UNREACHABLE", detail: String(error?.message || error) });
        });
});

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

// ─── Main Server frontend mode (dev / local-dist / package-dist) ─────────────
// Same `netget frontend-mode` CLI command the interactive menu already uses —
// this is the HTTP door onto it, not a separate implementation, so the panel
// toggle and the CLI can never drift out of sync with each other.
router.get("/frontend-mode", async (req, res) => {
    const result = await runNetgetCommand(["frontend-mode", "--json"]);
    res.status(result.ok ? 200 : 502).json(result);
});

router.post("/frontend-mode", async (req, res) => {
    const mode = String(req.body?.mode || "").trim();
    if (mode !== "dev" && mode !== "local-dist" && mode !== "package-dist") {
        return res.status(400).json({ ok: false, message: `Invalid mode: "${mode}". Use dev, local-dist, or package-dist.` });
    }
    const result = await runNetgetCommand(["frontend-mode", mode, "--json"]);
    res.status(result.ok ? 200 : 502).json(result);
});

// ─── Per-app frontend mode (dev / dist) ───────────────────────────────────────
// Same generalization pattern as /frontend-mode above, but scoped to a
// registered app instead of netget's own panel — the HTTP door onto
// `netget app-frontend-mode`. Not the route a scaffolded app's own
// FrontendModeLauncher bubble calls (that hits the gateway directly at
// /apps/<name>/__frontend-mode, via apps.lua — see setNginxConfigRoutes.ts);
// this one is for netget's own admin panel to drive the same toggle.
router.get("/apps/:name/frontend-mode", async (req, res) => {
    const name = String(req.params.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, message: "App name is required." });
    const result = await runNetgetCommand(["app-frontend-mode", name, "--json"]);
    res.status(result.ok ? 200 : 502).json(result);
});

router.post("/apps/:name/frontend-mode", async (req, res) => {
    const name = String(req.params.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, message: "App name is required." });
    const mode = String(req.body?.mode || "").trim();
    if (mode !== "dev" && mode !== "dist") {
        return res.status(400).json({ ok: false, message: `Invalid mode: "${mode}". Use dev or dist.` });
    }
    const result = await runNetgetCommand(["app-frontend-mode", name, mode, "--json"]);
    res.status(result.ok ? 200 : 502).json(result);
});

// ─── Semantic Inspector: Explain / Inspect ────────────────────────────────────
// Passthrough to netget's own monad (see kernel/netgetMonadProcess.ts) — the
// browser never talks to the monad's port directly, it goes through this
// same-origin route like every other panel feature. `me.explain`/`me.execute`
// in main.jsx's `mount()` option call these; this.gui's Inspector
// (hasKernelExplain in runtime/inspector.tsx) lights up once they respond.
//
// `path` is expected to be a fully-qualified, ALREADY-PREFIXED kernel path
// (e.g. "users.jabellae.domains.example-com" — see domainStore.ts's
// toDomainRecord(), which computes this per-record as `semanticPath` so a
// GUI node's provenance can point straight at it without the frontend
// needing to know netget's owner/escaping convention itself). Sending the
// bare root namespace (no owner prefix) as x-forwarded-host makes
// namespaceToKernelPrefix() resolve to "" (kernel root) server-side, so the
// path is used as-is instead of getting a second prefix layered on top —
// confirmed by testing (a real per-owner path here would otherwise only
// ever resolve under the "netget" identity, not each domain's real owner).
router.post("/explain", async (req, res) => {
    const path = String(req.body?.path || "").trim();
    if (!path) return res.status(400).json({ ok: false, error: "PATH_REQUIRED" });
    try {
        const origin = await getNetgetMonadOrigin();
        const upstream = await fetch(`${origin}/explain`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-forwarded-host": getGatewayRootNamespace(),
            },
            body: JSON.stringify({ path }),
        });
        const payload = await upstream.json();
        res.status(upstream.status).json(payload);
    } catch (error) {
        res.status(502).json({ ok: false, error: "MONAD_UNREACHABLE", detail: String(error?.message || error) });
    }
});

router.post("/inspect", async (req, res) => {
    try {
        const origin = await getNetgetMonadOrigin();
        const upstream = await fetch(`${origin}/inspect`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-forwarded-host": getGatewayRootNamespace(),
            },
            body: JSON.stringify(req.body || {}),
        });
        const payload = await upstream.json();
        res.status(upstream.status).json(payload);
    } catch (error) {
        res.status(502).json({ ok: false, error: "MONAD_UNREACHABLE", detail: String(error?.message || error) });
    }
});

// ─── cleaker TopologyResolver ─────────────────────────────────────────────────
// netget's implementation of cleaker's own TopologyResolver interface
// (modules/cleaker/Typescript/src/topology/resolver.ts) — see
// kernel/topologyResolver.ts for the full explanation. Addressed at
// local.cleaker (added alongside local.netget in setNginxConfigRoutes.ts's
// admin server_name block) so cleaker's resolver has its own name, distinct
// from local.netget's admin/control-plane surface, even though today both
// resolve to this same backend process.
router.get("/cleaker/resolve", async (req, res) => {
    const namespace = String(req.query?.namespace || "").trim();
    if (!namespace) return res.status(400).json({ ok: false, error: "NAMESPACE_REQUIRED" });
    try {
        const endpoint = await resolveSurface({ namespace, selector: req.query?.selector });
        if (!endpoint) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        res.json({ ok: true, endpoint });
    } catch (error) {
        res.status(500).json({ ok: false, error: "RESOLVE_FAILED", detail: String(error?.message || error) });
    }
});

// ─── this.gui SeedSessionProvider passthrough (dev-mode only) ────────────────
// In production, this.gui's monad client reaches netget's own monad through
// nginx's generic /apps/:name mesh proxy (monad_proxy.lua) — see
// resolveNetgetSeed.js's netgetMonadTransportOrigin(). Vite's dev server
// blindly forwards all of /apps/* here (vite.config.js), so this dev server
// needs its own equivalent of that same generic reverse proxy — unlike
// /explain and /inspect above (fixed request shapes), claim/open/write/read
// each hit a different sub-path with a different method, and the client
// sets its own x-forwarded-host (the claimed namespace, e.g.
// "jabellae.suis-macbook-air.local") — that header must pass through
// unmodified, not be overwritten with getGatewayRootNamespace() like
// /explain and /inspect do for their own fully-qualified paths.
router.all(/^\/apps\/netget(\/.*)?$/, async (req, res) => {
    try {
        const origin = await getNetgetMonadOrigin();
        const tail = req.params[0] || "";
        const upstream = await fetch(`${origin}${tail}`, {
            method: req.method,
            headers: {
                "content-type": req.headers["content-type"] || "application/json",
                accept: req.headers["accept"] || "application/json",
                "x-forwarded-host": req.headers["x-forwarded-host"] || req.headers["host"] || "",
            },
            body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
        });
        const payload = await upstream.json().catch(() => ({}));
        res.status(upstream.status).json(payload);
    } catch (error) {
        res.status(502).json({ ok: false, error: "MONAD_UNREACHABLE", detail: String(error?.message || error) });
    }
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
// localIP is live-detected every call (this machine's own NIC never needs
// a stored value); publicIP is NOT re-detected here -- it's whatever
// i_DefaultNetGetX.ts's init-time getPublicIP() call last saved to xConfig
// (same value setNginxConfigRoutes.ts and NetGetX.cli.ts's status display
// already read), empty string if this host was never brought online with a
// public IP (a private-network-only local dev machine, for example).
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

router.get('/ip-info', async (req, res) => {
    try {
        const interfaces = os.networkInterfaces();
        const localIP = Object.values(interfaces)
            .flat()
            .find(iface => iface && !iface.internal && iface.family === 'IPv4')?.address ?? 'Not available';
        const xConfig = await loadOrCreateXConfig();
        // Some xConfig files on disk carry stale non-IP sentinel strings
        // (e.g. a literal "Not available") from an older writer -- never
        // forward one of those as if it were a real address.
        const storedPublicIP = String(xConfig.publicIP || '');
        const publicIP = IPV4_PATTERN.test(storedPublicIP) ? storedPublicIP : '';
        res.json({ success: true, localIP, publicIP });
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

// ─── Domain routing CRUD (kernel-backed) ───────────────────────────────────
// Replaces the legacy SQLite-backed admin API that used to live entirely in
// lua/handlers/domains.lua. Every mutating domainStore.ts function already
// calls regenerateMap() internally, so domain-map.json — what OpenResty's
// routing hot path actually reads — stays in sync automatically on every
// write. Before this, a "successful" /add-domain could be completely
// invisible to real routing: SQLite and the kernel were two independent
// stores, and nothing regenerated domain-map.json from SQLite. See
// docs/DomainStoreSplitBrain.md. Response shapes here are copied verbatim
// from domains.lua's, so Domains.jsx needed zero changes for this migration.

router.get('/domains', async (req, res) => {
    const domains = await getDomains();
    res.json({ success: true, domains, count: domains.length });
});

// Which namespace this netget instance's own monad is designated as —
// distinct from gatewayId (the physical host, /gateway-identity) and from
// owner/ownerUsername (who administers this gateway). This is the
// designated context (getGatewayRootNamespace()'s own three-source
// resolution: NETGET_MONAD_NAMESPACE -> xConfig.mainServerName ->
// "local.cleaker") -- see Namespace-Is-Context.md for why a host and a
// namespace must never be conflated.
router.get('/main-server-namespace', async (req, res) => {
    // namespace is the resolved value (falls back to "local.cleaker" when
    // unconfigured). mainServerName is the RAW xConfig value, unresolved --
    // empty when nothing has been set via mainServer.cli.ts. Returning both
    // lets a caller distinguish "explicitly configured" from "using the
    // default," which the resolved value alone can't tell you.
    const xConfig = await loadOrCreateXConfig();
    res.json({
        namespace: getGatewayRootNamespace(),
        mainServerName: String(xConfig.mainServerName || '').trim() || null,
    });
});

router.get('/domains/:parent/subdomains', async (req, res) => {
    const parent = req.params.parent;
    const domains = await getDomains();
    const subdomains = domains.filter((d) => d.subdomain === parent && d.domain !== parent);
    res.json({ subdomains });
});

router.post('/add-domain', async (req, res) => {
    const body = req.body || {};
    if (!body.domain) {
        return res.status(400).json({ error: 'domain is required' });
    }
    try {
        await registerDomain(
            body.domain, body.subdomain, body.email, body.sslMode,
            body.sslCertificate, body.sslCertificateKey, body.target,
            body.type, body.projectPath, body.owner,
        );
    } catch {
        return res.status(409).json({ error: 'Domain already exists' });
    }
    res.json({ success: true, domain: body.domain });
});

router.post('/update-domain', async (req, res) => {
    const body = req.body || {};
    if (!body.domain || !body.updatedFields) {
        return res.status(400).json({ error: 'domain and updatedFields are required' });
    }
    const f = body.updatedFields;
    await updateDomain(
        body.domain, f.subdomain, f.email, f.sslMode, f.sslCertificate,
        f.sslCertificateKey, f.target, f.type, f.projectPath, f.owner,
    );
    res.json({ success: true, domain: body.domain });
});

router.post('/delete-domain', async (req, res) => {
    const body = req.body || {};
    const domain = body.domain;
    if (!domain) {
        return res.status(400).json({ error: 'domain is required' });
    }
    const existing = await getDomainByName(domain);
    if (!existing) {
        return res.status(404).json({ error: 'Domain not found' });
    }
    await deleteDomain(domain);
    res.json({ success: true, domain });
});

// Existence check now goes through the same kernel-backed store as the CRUD
// above (previously its own separate SQLite query in domains.lua) — the
// actual provisioning work is unchanged: shells out to `netget provision-cert`
// (netget.cli.ts -> certbotProvision.ts), same as /openresty-status etc.
// above. Real certbot round-trip — expect tens of seconds, not milliseconds.
router.post('/provision-cert', async (req, res) => {
    const body = req.body || {};
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!domain) {
        return res.status(400).json({ error: 'domain is required and must be a valid hostname' });
    }
    if (!email) {
        return res.status(400).json({ error: 'email is required and must be a valid address' });
    }
    const existing = await getDomainByName(domain);
    if (!existing) {
        return res.status(404).json({ error: 'Domain not registered — call /add-domain first' });
    }
    const result = await runNetgetCommand(['provision-cert', domain, '--email', email]);
    res.status(result.ok ? 200 : 502).json(result);
});

export default router;
