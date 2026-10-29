import os from 'os';
import { resolveAppIdentity } from './runtime/appIdentity.js';
import type { NetGetExposurePolicyInput } from './runtime/exposurePolicy.js';
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
    /** Called after every report attempt (the first and each heartbeat): `null` when the gateway took it, the error when not. */
    onReport?: (error: Error | null) => void;
    kind?: NetGetAppKind;
    status?: NetGetAppStatus;
    health?: NetGetAppHealth;
    ui?: NetGetAppUi;
    exposure?: NetGetExposurePolicyInput;
    lifecycle?: NetGetAppLifecycle;
}

export type NetGetAppKind = 'app' | 'monad' | 'service' | 'system';
export type NetGetAppStatus = 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export interface NetGetAppHealth {
    state: 'unknown' | 'healthy' | 'degraded' | 'unhealthy';
    updatedAt?: string;
    message?: string;
}

export interface NetGetAppUi {
    hasAdminPanel?: boolean;
    hasUserPanel?: boolean;
    defaultPath?: string;
}

export interface NetGetAppLifecycle {
    supportsStart?: boolean;
    supportsStop?: boolean;
    supportsRestart?: boolean;
    supportsPause?: boolean;
    supportsResume?: boolean;
    supportsDelete?: boolean;
}

export interface NetGetAppRegistration {
    id: string;
    name: string;
    kind?: NetGetAppKind;
    pid: number;
    cwd: string;
    hostname: string;
    port?: number;
    protocol: 'http' | 'https';
    host: string;
    url?: string;
    tags: string[];
    metadata: Record<string, unknown>;
    status?: NetGetAppStatus;
    health?: NetGetAppHealth;
    ui?: NetGetAppUi;
    exposure?: NetGetExposurePolicyInput;
    lifecycle?: NetGetAppLifecycle;
    startedAt: string;
    updatedAt: string;
    ttlMs: number;
    leaseId?: string;
    mode: PortLeaseMode;
    portStatus: string;
}

interface NetGetSessionBase {
    id: string;
    name: string;
    port: number;
    url: string;
    mode: PortLeaseMode;
    endpoint: string;
    registration: NetGetAppRegistration;
    report(): Promise<void>;
    stop(): Promise<void>;
}

/** What netget() returns: the app asked netget for its port, so the session holds the lease. */
export interface NetGetSession extends NetGetSessionBase {
    lease: PortLease;
}

/** What attachExisting() returns: the app already had its port, so there is no lease. */
export interface NetGetAttachedSession extends NetGetSessionBase {
    lease?: undefined;
}

/**
 * An app that is ALREADY running on a port of its own (FullTrailer on 4100, a Vite server, a dist behind a static
 * server) and only wants to be listed. Same registration, same heartbeat and same release as netget(); the difference
 * is that nothing is leased -- a lease cannot be taken on a port somebody already listens on -- and that the name is
 * used exactly as given (a name with a dot is not rewritten, because the routes `app:<name>` and the panel use it).
 */
export interface NetGetAttachOptions extends Omit<NetGetAppOptions, 'port' | 'mode' | 'name'> {
    name: string;
    port: number;
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

interface RegistrationBase {
    id: string;
    port: number;
    ttlMs: number;
    leaseId?: string;
    mode: PortLeaseMode;
    portStatus: string;
}

function buildRegistration(options: NetGetAppOptions, name: string, base: RegistrationBase): NetGetAppRegistration {
    const protocol = options.protocol || 'http';
    const host = options.host || '127.0.0.1';
    const port = base.port;
    const url = options.url || `${protocol}://${host}:${port}`;
    const now = new Date().toISOString();

    return {
        id: base.id,
        name,
        kind: options.kind || 'app',
        pid: process.pid,
        cwd: process.cwd(),
        hostname: os.hostname(),
        port,
        protocol,
        host,
        url,
        tags: options.tags || [],
        metadata: options.metadata || {},
        status: options.status,
        health: options.health,
        ui: options.ui,
        exposure: options.exposure,
        lifecycle: options.lifecycle,
        startedAt: now,
        updatedAt: now,
        ttlMs: base.ttlMs,
        leaseId: base.leaseId,
        mode: base.mode,
        portStatus: base.portStatus,
    };
}

async function postJson(endpoint: string, payload: unknown): Promise<void> {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`NetGet local report failed (${res.status}): ${text || res.statusText}`);
    }
}

interface ReportingParts {
    registration: NetGetAppRegistration;
    endpoint: string;
    releaseEndpoint: string;
    releaseBody: Record<string, unknown>;
    heartbeatMs: number;
    strict?: boolean;
    onReport?: (error: Error | null) => void;
    /** Runs before every report; its result says how the port stands (the lease heartbeat, for netget()). */
    beforeReport?: () => Promise<string | void>;
    /** Runs when the session ends, after the app is released (gives the lease back, for netget()). */
    afterStop?: () => Promise<void>;
}

/** The report / heartbeat / release machinery both netget() and attachExisting() share. */
async function startReporting(parts: ReportingParts): Promise<{ report(): Promise<void>; stop(): Promise<void> }> {
    const { registration, endpoint, releaseEndpoint, releaseBody, heartbeatMs, strict } = parts;
    let closed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const report = async (): Promise<void> => {
        const portStatus = await parts.beforeReport?.();
        registration.updatedAt = new Date().toISOString();
        registration.pid = process.pid;
        registration.cwd = process.cwd();
        if (portStatus) registration.portStatus = portStatus;
        await postJson(endpoint, registration);
    };
    const attempt = async (): Promise<void> => {
        try {
            await report();
            parts.onReport?.(null);
        } catch (error) {
            parts.onReport?.(error as Error);
            throw error;
        }
    };

    const release = async (): Promise<void> => {
        await postJson(releaseEndpoint, releaseBody).catch(() => {});
        await parts.afterStop?.();
    };

    try {
        await attempt();
    } catch (error) {
        if (strict) {
            await parts.afterStop?.();
            throw error;
        }
    }

    timer = setInterval(() => {
        if (closed) return;
        attempt().catch((error) => {
            if (strict) {
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
    return { report, stop };
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
    const registration = buildRegistration(options, name, {
        id: lease.leaseId, port: lease.port, ttlMs: lease.ttlMs, leaseId: lease.leaseId, mode: lease.mode, portStatus: lease.status,
    });
    const { report, stop } = await startReporting({
        registration, endpoint, releaseEndpoint, heartbeatMs, strict: options.strict, onReport: options.onReport,
        releaseBody: { id: registration.id, name, leaseId: lease.leaseId },
        beforeReport: async () => (await heartbeatPortLease(lease, 'active')).status,
        afterStop: () => releasePortLease(lease),
    });

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

/** The name rule apps.lua applies, so a wrong name fails here with a message and not as a 400 from the gateway. */
export function validateAttachName(raw: string): string | null {
    const name = String(raw ?? '');
    if (!name) return 'An app name is required.';
    if (name.length > 63) return 'An app name is at most 63 characters.';
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return 'An app name is lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.';
    return null;
}

/** The id an attached app is listed under: the same `app:<name>` the routes and the panel use. */
export const attachedAppId = (name: string): string => `app:${name}`;

export async function attachExisting(options: NetGetAttachOptions): Promise<NetGetAttachedSession> {
    const problem = validateAttachName(options.name);
    if (problem) throw new Error(problem);
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('A port between 1 and 65535 is required.');
    const mainServer = normalizeMainServer(options.mainServer);
    const endpoint = `${mainServer}/apps/report`;
    const releaseEndpoint = `${mainServer}/apps/release`;
    const heartbeatMs = Math.max(options.heartbeatMs || DEFAULT_HEARTBEAT_MS, 1_000);
    const id = attachedAppId(options.name);
    const registration = buildRegistration(options, options.name, {
        id, port: options.port, ttlMs: Math.max(heartbeatMs * 4, 12_000), mode: 'fixed', portStatus: 'external',
    });
    const { report, stop } = await startReporting({
        registration, endpoint, releaseEndpoint, heartbeatMs, strict: options.strict, onReport: options.onReport,
        releaseBody: { id, name: options.name },
    });
    return {
        id,
        name: options.name,
        port: options.port,
        url: registration.url || `${registration.protocol}://${registration.host}:${options.port}`,
        mode: 'fixed',
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
