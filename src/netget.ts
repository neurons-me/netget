import os from 'os';
import { resolveAppIdentity } from './runtime/appIdentity.js';
import {
    allocatePortLease,
    heartbeatPortLease,
    releasePortLease,
    type PortLease,
    type PortLeaseMode,
} from './runtime/portLeases.js';

export interface NetGetAppOptions {
    name?: string;
    port?: number | 'auto';
    mode?: PortLeaseMode;
    protocol?: 'http' | 'https';
    host?: string;
    url?: string;
    mainServer?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    heartbeatMs?: number;
    strict?: boolean;
}

export interface NetGetAppRegistration {
    id: string;
    name: string;
    pid: number;
    cwd: string;
    hostname: string;
    port?: number;
    protocol: 'http' | 'https';
    host: string;
    url?: string;
    tags: string[];
    metadata: Record<string, unknown>;
    startedAt: string;
    updatedAt: string;
    ttlMs: number;
    leaseId?: string;
    mode: PortLeaseMode;
    portStatus: string;
}

export interface NetGetSession {
    id: string;
    name: string;
    port: number;
    url: string;
    mode: PortLeaseMode;
    lease: PortLease;
    endpoint: string;
    registration: NetGetAppRegistration;
    report(): Promise<void>;
    stop(): Promise<void>;
}

export interface NetGetConfig {
    [key: string]: any;
}

const DEFAULT_MAIN_SERVER = 'http://local.netget';
const DEFAULT_HEARTBEAT_MS = 3_000;
const LOCAL_HOSTS = new Set(['local.netget', 'localhost', '127.0.0.1', '[::1]', '::1']);

function normalizeMainServer(value?: string): string {
    const raw = (value || process.env.NETGET_LOCAL || DEFAULT_MAIN_SERVER).trim().replace(/\/+$/, '');
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('NetGet local endpoint must use http:// or https://.');
    }
    if (!LOCAL_HOSTS.has(parsed.hostname)) {
        throw new Error(
            `Refusing to report directly to remote NetGet '${parsed.hostname}'. ` +
            'Apps report to local NetGet only; use Main Server remote links for network-to-network sync.'
        );
    }
    return parsed.toString().replace(/\/+$/, '');
}

function inferFixedPort(): number | undefined {
    const raw = process.env.NETGET_PORT || process.env.PORT || process.env.VITE_PORT;
    if (!raw) return undefined;
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function resolveMode(options: NetGetAppOptions): PortLeaseMode {
    if (options.mode) return options.mode;
    if (typeof options.port === 'number') return 'fixed';
    return 'auto';
}

function buildRegistration(options: NetGetAppOptions, name: string, lease: PortLease): NetGetAppRegistration {
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

async function postJson(endpoint: string, payload: unknown): Promise<void> {
    const fetchImpl = globalThis.fetch || (await import('node-fetch')).default as any;
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

export async function netget(options: NetGetAppOptions = {}): Promise<NetGetSession> {
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
    let timer: ReturnType<typeof setInterval> | undefined;

    const report = async (): Promise<void> => {
        const currentLease = await heartbeatPortLease(lease, 'active');
        registration.updatedAt = new Date().toISOString();
        registration.pid = process.pid;
        registration.cwd = process.cwd();
        registration.portStatus = currentLease.status;
        await postJson(endpoint, registration);
    };

    const release = async (): Promise<void> => {
        await postJson(releaseEndpoint, { id: registration.id, name, leaseId: lease.leaseId }).catch(() => {});
        await releasePortLease(lease);
    };

    try {
        await report();
    } catch (error) {
        if (options.strict) {
            await releasePortLease(lease);
            throw error;
        }
    }

    timer = setInterval(() => {
        if (closed) return;
        report().catch((error) => {
            if (options.strict) {
                console.warn(`[netget] heartbeat failed: ${error.message}`);
            }
        });
    }, heartbeatMs);
    timer.unref?.();

    const stop = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        await release();
    };

    const gracefulExit = async () => {
        await stop().catch(() => {});
    };

    process.once('beforeExit', () => {
        void gracefulExit();
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
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
    private config?: NetGetConfig;

    constructor(config?: NetGetConfig) {
        this.config = config;
    }

    getConfig(): NetGetConfig | undefined {
        return this.config;
    }

    updateConfig(newConfig: Partial<NetGetConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
}

export default netget;
