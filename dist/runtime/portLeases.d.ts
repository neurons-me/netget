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
declare const AUTO_PORT_RANGE: {
    start: number;
    end: number;
};
export declare function allocatePortLease(name: string, options?: AllocatePortLeaseOptions): Promise<PortLease>;
export declare function heartbeatPortLease(lease: PortLease, status?: PortLeaseStatus): Promise<PortLease>;
export declare function releasePortLease(lease: Pick<PortLease, 'name' | 'port'>): Promise<void>;
export declare function listPortLeases(): Promise<Array<PortLease & {
    fresh: boolean;
    pidAlive: boolean;
}>>;
export { AUTO_PORT_RANGE };
//# sourceMappingURL=portLeases.d.ts.map