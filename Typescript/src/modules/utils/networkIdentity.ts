//netget/src/modules/utils/networkIdentity.ts
//
// How netget knows its own network addresses, kept apart from what it may conclude from them.
//
// Three different facts that used to travel as one field ("publicIP"):
//   * the PUBLIC ADDRESS OBSERVED from outside (what a third party sees this host as): a fact about the world,
//     detected, dated, and kept as the last known value when a later check fails;
//   * the LOCAL ADDRESS: the first non-internal IPv4 of this machine's interfaces. On a cloud VM it is private
//     (10.x) and is a detail of the infrastructure, not something to show on a public door;
//   * whether the gateway is REACHABLE from the internet: NOT derived here. A public address having been observed
//     does not prove that anything answers on it (firewall, security group, nothing listening, NAT that is not 1:1).
//
// Detection is bounded (a timeout), never throws, never blocks startup on a third party, and does not touch nginx:
// it writes xConfig.json and nothing else. Whatever consumes the address regenerates its own output when an
// operator asks it to.

import { getLocalIP } from './ipUtils.ts';
import { loadOrCreateXConfig, saveXConfig } from '../NetGetX/config/xConfig.ts';
import type { XConfig } from '../NetGetX/config/xConfig.ts';

export type DetectionState = 'detected' | 'pending' | 'failed';

export interface PublicIPDetection {
    state: DetectionState;
    /** When an address was last actually observed. Survives a later failure (it dates the stored value). */
    observedAt: string | null;
    /** When a check was last attempted, successful or not. */
    checkedAt: string | null;
    source: string;
    error?: string;
}

export const PUBLIC_IP_SOURCE = 'api.ipify.org';
export const PUBLIC_IP_URL = 'https://api.ipify.org?format=json';
export const DEFAULT_DETECT_TIMEOUT_MS = 3000;

export function isIPv4(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const m = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/** Private, loopback, link-local, CGNAT and "this network": addresses that identify nothing on the internet. */
export function isPrivateIPv4(ip: string): boolean {
    if (!isIPv4(ip)) return false;
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
        || (a === 192 && b === 168)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 169 && b === 254)
        || (a === 100 && b >= 64 && b <= 127);
}

/** A well-formed IPv4 that could be someone's public address (not private, not multicast/reserved). */
export function isPublicIPv4(ip: unknown): ip is string {
    if (!isIPv4(ip) || isPrivateIPv4(ip)) return false;
    return Number(ip.split('.')[0]) < 224;
}

export type PublicIPResult = { ok: true; ip: string } | { ok: false; error: string };

/**
 * Asks a third party what address this host appears as. Bounded by `timeoutMs`; an answer that is not a public
 * IPv4 is a failure, not a value.
 */
export async function detectPublicIP(opts: { fetchImpl?: typeof fetch; timeoutMs?: number; url?: string } = {}): Promise<PublicIPResult> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(opts.url ?? PUBLIC_IP_URL, { signal: controller.signal });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const body = (await res.json()) as { ip?: unknown };
        if (!isPublicIPv4(body?.ip)) return { ok: false, error: 'the answer was not a public IPv4 address' };
        return { ok: true, ip: body.ip };
    } catch (err: any) {
        if (controller.signal.aborted) return { ok: false, error: `no answer within ${timeoutMs} ms` };
        return { ok: false, error: String(err?.message || err) };
    } finally {
        clearTimeout(timer);
    }
}

/** What xConfig should say after a check: a new value on success, the last known value (and why it is not newer) on failure. */
export function nextPublicIP(
    previous: { publicIP?: string; publicIPDetection?: PublicIPDetection | null },
    result: PublicIPResult,
    nowIso: string,
): { publicIP: string; publicIPDetection: PublicIPDetection } {
    if (result.ok) {
        return {
            publicIP: result.ip,
            publicIPDetection: { state: 'detected', observedAt: nowIso, checkedAt: nowIso, source: PUBLIC_IP_SOURCE },
        };
    }
    const kept = isIPv4(previous.publicIP) ? previous.publicIP : '';
    return {
        publicIP: kept,
        publicIPDetection: {
            state: 'failed',
            observedAt: kept ? previous.publicIPDetection?.observedAt ?? null : null,
            checkedAt: nowIso,
            source: PUBLIC_IP_SOURCE,
            error: (result as { ok: false; error: string }).error,
        },
    };
}

export interface EnsureOptions {
    load?: () => Promise<XConfig>;
    save?: (updates: Partial<XConfig>) => Promise<void>;
    detect?: () => Promise<PublicIPResult>;
    getLocal?: () => string | null;
    now?: () => Date;
    timeoutMs?: number;
}

export interface EnsureResult {
    /** the public address or the local address differs from what xConfig had */
    changed: boolean;
    previousPublicIP: string;
    publicIP: string;
    localIP: string;
    publicIPDetection: PublicIPDetection;
}

/**
 * The one place that detects and stores the addresses. Safe to call from any startup path: bounded, never throws,
 * keeps the last known public address when the check fails, and writes xConfig.json only.
 */
export async function ensureNetworkIdentity(opts: EnsureOptions = {}): Promise<EnsureResult> {
    const load = opts.load ?? loadOrCreateXConfig;
    const save = opts.save ?? ((u: Partial<XConfig>) => saveXConfig(u as any));
    const detect = opts.detect ?? (() => detectPublicIP({ timeoutMs: opts.timeoutMs }));
    const getLocal = opts.getLocal ?? getLocalIP;
    const nowIso = (opts.now ? opts.now() : new Date()).toISOString();

    const current: XConfig = await load();
    let result: PublicIPResult;
    try {
        result = await detect();
    } catch (err: any) {
        result = { ok: false, error: String(err?.message || err) };
    }
    const next = nextPublicIP(current as any, result, nowIso);
    const local = getLocal();
    const localIP = local && isIPv4(local) ? local : (isIPv4(current.localIP) ? String(current.localIP) : '');

    await save({ publicIP: next.publicIP, localIP, publicIPDetection: next.publicIPDetection });

    return {
        changed: next.publicIP !== String(current.publicIP || '') || localIP !== String(current.localIP || ''),
        previousPublicIP: String(current.publicIP || ''),
        publicIP: next.publicIP,
        localIP,
        publicIPDetection: next.publicIPDetection,
    };
}

/** What to say about the public address, in words that claim only what is known. */
export function describePublicAddress(x: { publicIP?: unknown; publicIPDetection?: PublicIPDetection | null } | null | undefined): {
    value: string;
    state: DetectionState | 'unknown';
    text: string;
} {
    const value = isIPv4(x?.publicIP) ? String(x?.publicIP) : '';
    const d = x?.publicIPDetection ?? null;
    const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '');
    if (value && d?.state === 'detected') return { value, state: 'detected', text: `${value} (observed ${day(d.observedAt)})` };
    if (value && d?.state === 'failed') {
        return { value, state: 'failed', text: `${value} (last known${d.observedAt ? `, observed ${day(d.observedAt)}` : ''}; the latest check failed: ${d.error || 'no answer'})` };
    }
    if (value) return { value, state: 'unknown', text: `${value} (stored; no detection record)` };
    if (d?.state === 'failed') return { value: '', state: 'failed', text: `not detected (the check failed: ${d.error || 'no answer'})` };
    return { value: '', state: d?.state === 'pending' ? 'pending' : 'unknown', text: 'not detected yet' };
}
