export const RESERVED_LOCAL_DOMAINS = new Set(['local.netget', 'localhost', '127.0.0.1']);

export function isReservedLocalDomain(domain: string): boolean {
    return RESERVED_LOCAL_DOMAINS.has(String(domain || '').trim().toLowerCase());
}
