import crypto from 'crypto';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { getNetgetDataDir } from '../utils/netgetPaths.js';

export type PortLeaseMode = 'auto' | 'fixed';
export type PortLeaseStatus = 'allocated' | 'active' | 'stale' | 'dead' | 'orphan';

export interface PortLease {
    leaseId: string;
    name: string;
    port: number;
    pid: number;
    cwd: string;
    mode: PortLeaseMode;
    status: PortLeaseStatus;
    since: string;
    heartbeat: number;
    ttlMs: number;
    lockPath: string;
}

export interface AllocatePortLeaseOptions {
    preferredPort?: number;
    mode?: PortLeaseMode;
    heartbeatMs?: number;
}

const AUTO_PORT_RANGE = { start: 42000, end: 49999 };
const DEFAULT_HEARTBEAT_MS = 3_000;
const DEFAULT_TTL_MS = 12_000;

function runtimeDir(): string {
    return path.join(getNetgetDataDir(), 'runtime');
}

function portsDir(): string {
    return path.join(runtimeDir(), 'ports');
}

function locksDir(): string {
    return path.join(runtimeDir(), 'locks');
}

function leasePathForName(name: string): string {
    return path.join(portsDir(), `${name}.json`);
}

function lockPathForPort(port: number): string {
    return path.join(locksDir(), `port-${port}.lock`);
}

async function ensureLeaseDirs(): Promise<void> {
    await fs.mkdir(portsDir(), { recursive: true });
    await fs.mkdir(locksDir(), { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

function pidExists(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        return error?.code === 'EPERM';
    }
}

function isLeaseFresh(lease: PortLease): boolean {
    return Date.now() - Number(lease.heartbeat || 0) <= Number(lease.ttlMs || DEFAULT_TTL_MS);
}

async function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

async function tryCreatePortLock(port: number, name: string): Promise<boolean> {
    const lockPath = lockPathForPort(port);
    try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.writeFile(JSON.stringify({
            port,
            name,
            pid: process.pid,
            createdAt: new Date().toISOString(),
        }, null, 2));
        await handle.close();
        return true;
    } catch (error: any) {
        if (error?.code === 'EEXIST') return false;
        throw error;
    }
}

async function removePortLock(port: number): Promise<void> {
    await fs.unlink(lockPathForPort(port)).catch(() => {});
}

async function removeLeaseFile(name: string): Promise<void> {
    await fs.unlink(leasePathForName(name)).catch(() => {});
}

async function releaseStaleLease(lease: PortLease): Promise<void> {
    await removeLeaseFile(lease.name);
    await removePortLock(lease.port);
}

async function getReusablePortFromExistingLease(name: string): Promise<number | undefined> {
    const existing = await readJson<PortLease>(leasePathForName(name));
    if (!existing) return undefined;

    const alive = pidExists(existing.pid);
    const fresh = isLeaseFresh(existing);
    if (alive && fresh) {
        throw new Error(`NetGet app '${name}' already has an active port lease on ${existing.port}.`);
    }

    await releaseStaleLease(existing);
    return existing.port;
}

function assertPortNumber(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${port}`);
    }
}

async function writeLease(lease: PortLease): Promise<void> {
    const tmpPath = `${leasePathForName(lease.name)}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(lease, null, 2), 'utf8');
    await fs.rename(tmpPath, leasePathForName(lease.name));
}

function createLease(name: string, port: number, mode: PortLeaseMode, heartbeatMs: number): PortLease {
    return {
        leaseId: crypto.randomUUID(),
        name,
        port,
        pid: process.pid,
        cwd: process.cwd(),
        mode,
        status: 'allocated',
        since: new Date().toISOString(),
        heartbeat: Date.now(),
        ttlMs: Math.max(heartbeatMs * 4, DEFAULT_TTL_MS),
        lockPath: lockPathForPort(port),
    };
}

async function tryClaimPort(name: string, port: number, mode: PortLeaseMode, heartbeatMs: number): Promise<PortLease | null> {
    assertPortNumber(port);

    const locked = await tryCreatePortLock(port, name);
    if (!locked) return null;

    const free = await isPortFree(port);
    if (!free) {
        await removePortLock(port);
        return null;
    }

    const lease = createLease(name, port, mode, heartbeatMs);
    await writeLease(lease);
    return lease;
}

function buildAutoCandidates(preferredPort?: number): number[] {
    const ports: number[] = [];
    if (preferredPort && preferredPort >= AUTO_PORT_RANGE.start && preferredPort <= AUTO_PORT_RANGE.end) {
        ports.push(preferredPort);
    }
    for (let port = AUTO_PORT_RANGE.start; port <= AUTO_PORT_RANGE.end; port++) {
        if (port !== preferredPort) ports.push(port);
    }
    return ports;
}

export async function allocatePortLease(name: string, options: AllocatePortLeaseOptions = {}): Promise<PortLease> {
    await ensureLeaseDirs();

    const mode: PortLeaseMode = options.mode || (options.preferredPort ? 'fixed' : 'auto');
    const heartbeatMs = Math.max(options.heartbeatMs || DEFAULT_HEARTBEAT_MS, 1_000);
    const reusablePort = await getReusablePortFromExistingLease(name);

    if (mode === 'fixed') {
        const port = options.preferredPort ?? reusablePort;
        if (!port) throw new Error(`Fixed port mode requires a port for '${name}'.`);
        const lease = await tryClaimPort(name, port, mode, heartbeatMs);
        if (!lease) throw new Error(`Port ${port} is not available for '${name}'.`);
        return lease;
    }

    const candidates = buildAutoCandidates(reusablePort || options.preferredPort);
    for (const port of candidates) {
        const lease = await tryClaimPort(name, port, mode, heartbeatMs);
        if (lease) return lease;
    }

    throw new Error(`No free NetGet ports in range ${AUTO_PORT_RANGE.start}-${AUTO_PORT_RANGE.end}.`);
}

export async function heartbeatPortLease(lease: PortLease, status: PortLeaseStatus = 'active'): Promise<PortLease> {
    const next: PortLease = {
        ...lease,
        pid: process.pid,
        cwd: process.cwd(),
        status,
        heartbeat: Date.now(),
    };
    await ensureLeaseDirs();
    await writeLease(next);
    Object.assign(lease, next);
    return next;
}

export async function releasePortLease(lease: Pick<PortLease, 'name' | 'port'>): Promise<void> {
    await removeLeaseFile(lease.name);
    await removePortLock(lease.port);
}

export async function listPortLeases(): Promise<Array<PortLease & { fresh: boolean; pidAlive: boolean }>> {
    await ensureLeaseDirs();
    const files = await fs.readdir(portsDir()).catch(() => []);
    const leases: Array<PortLease & { fresh: boolean; pidAlive: boolean }> = [];

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const lease = await readJson<PortLease>(path.join(portsDir(), file));
        if (!lease) continue;
        leases.push({
            ...lease,
            fresh: isLeaseFresh(lease),
            pidAlive: pidExists(lease.pid),
        });
    }

    return leases.sort((a, b) => a.name.localeCompare(b.name));
}

export { AUTO_PORT_RANGE };
