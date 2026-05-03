import { type PortLease, type PortLeaseMode } from './runtime/portLeases.js';
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
export declare function netget(options?: NetGetAppOptions): Promise<NetGetSession>;
/**
 * Backwards-compatible configuration holder.
 */
export declare class NetGet {
    private config?;
    constructor(config?: NetGetConfig);
    getConfig(): NetGetConfig | undefined;
    updateConfig(newConfig: Partial<NetGetConfig>): void;
}
export default netget;
//# sourceMappingURL=netget.d.ts.map