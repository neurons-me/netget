import os from 'os';
import { resolveAppIdentity } from './runtime/appIdentity.js';
import { allocatePortLease, heartbeatPortLease, releasePortLease, } from './runtime/portLeases.js';
const DEFAULT_MAIN_SERVER = 'http://local.netget';
const DEFAULT_HEARTBEAT_MS = 3_000;
const LOCAL_HOSTS = new Set(['local.netget', 'localhost', '127.0.0.1', '[::1]', '::1']);
function normalizeMainServer(value) {
    const raw = (value || process.env.NETGET_LOCAL || DEFAULT_MAIN_SERVER).trim().replace(/\/+$/, '');
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('NetGet local endpoint must use http:// or https://.');
    }
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
        throw new Error(`Refusing to report directly to remote NetGet '${parsed.hostname}'. ` +
            'Apps report to local NetGet only; use Main Server remote links for network-to-network sync.');
    }
    return parsed.toString().replace(/\/+$/, '');
}
function inferFixedPort() {
    const raw = process.env.NETGET_PORT || process.env.PORT || process.env.VITE_PORT;
    if (!raw)
        return undefined;
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}
function resolveMode(options) {
    if (options.mode)
        return options.mode;
    if (typeof options.port === 'number')
        return 'fixed';
    return 'auto';
}
function buildRegistration(options, name, lease) {
    const protocol = options.protocol || 'http';
    const host = options.host || '127.0.0.1';
    const port = lease.port;
    const url = options.url || `${protocol}://${host}:${port}`;
    const now = new Date().toISOString();
    return {
        id: lease.leaseId,
        name,
        pid: process.pid,
        cwd: process.cwd(),
        hostname: os.hostname(),
        port,
        protocol,
        host,
        url,
        tags: options.tags || [],
        metadata: options.metadata || {},
        startedAt: now,
        updatedAt: now,
        ttlMs: lease.ttlMs,
        leaseId: lease.leaseId,
        mode: lease.mode,
        portStatus: lease.status,
    };
}
async function postJson(endpoint, payload) {
    const fetchImpl = globalThis.fetch || (await import('node-fetch')).default;
    const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`NetGet local report failed (${res.status}): ${text || res.statusText}`);
    }
}
export async function netget(options = {}) {
    const mainServer = normalizeMainServer(options.mainServer);
    const endpoint = `${mainServer}/apps/report`;
    const releaseEndpoint = `${mainServer}/apps/release`;
    const heartbeatMs = Math.max(options.heartbeatMs || DEFAULT_HEARTBEAT_MS, 1_000);
    const name = await resolveAppIdentity(options.name);
    const mode = resolveMode(options);
    const preferredPort = typeof options.port === 'number'
        ? options.port
        : mode === 'fixed'
            ? inferFixedPort()
            : undefined;
    const lease = await allocatePortLease(name, { mode, preferredPort, heartbeatMs });
    const registration = buildRegistration(options, name, lease);
    let closed = false;
    let timer;
    const report = async () => {
        const currentLease = await heartbeatPortLease(lease, 'active');
        registration.updatedAt = new Date().toISOString();
        registration.pid = process.pid;
        registration.cwd = process.cwd();
        registration.portStatus = currentLease.status;
        await postJson(endpoint, registration);
    };
    const release = async () => {
        await postJson(releaseEndpoint, { id: registration.id, name, leaseId: lease.leaseId }).catch(() => { });
        await releasePortLease(lease);
    };
    try {
        await report();
    }
    catch (error) {
        if (options.strict) {
            await releasePortLease(lease);
            throw error;
        }
    }
    timer = setInterval(() => {
        if (closed)
            return;
        report().catch((error) => {
            if (options.strict) {
                console.warn(`[netget] heartbeat failed: ${error.message}`);
            }
        });
    }, heartbeatMs);
    timer.unref?.();
    const stop = async () => {
        if (closed)
            return;
        closed = true;
        if (timer)
            clearInterval(timer);
        await release();
    };
    const gracefulExit = async () => {
        await stop().catch(() => { });
    };
    process.once('beforeExit', () => {
        void gracefulExit();
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            void gracefulExit().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
        });
    }
    return {
        id: registration.id,
        name,
        port: lease.port,
        url: registration.url || `${registration.protocol}://${registration.host}:${lease.port}`,
        mode: lease.mode,
        lease,
        endpoint,
        registration,
        report,
        stop,
    };
}
/**
 * Backwards-compatible configuration holder.
 */
export class NetGet {
    config;
    constructor(config) {
        this.config = config;
    }
    getConfig() {
        return this.config;
    }
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}
export default netget;
