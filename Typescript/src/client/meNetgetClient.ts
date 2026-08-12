import type { Surface } from '../types/Surface.js';

// Thin client over netget's own REST endpoints -- no new backend logic, no
// kernel involvement. `.me`-flavored ergonomics (me.netget.domains()) without
// being part of the ME kernel's Proxy/InstanceStore: netget's live,
// non-secret, ~5s-cadence telemetry has no reason to pay for encrypted-scope
// storage or snapshot-durability triggers.

const BASE_SURFACES = ['localhost', '127.0.0.1', 'local.netget'];

interface RawDomainRow {
  domain: string;
  subdomain?: string | null;
  sslMode?: string | null;
  target?: string | null;
  type?: string | null;
  owner?: string | null;
}

interface RawOpenRestyStatus {
  ok: boolean;
  mode?: string;
  detail?: string;
  httpListening?: boolean;
  httpsListening?: boolean;
  message?: string;
}

function domainRowToSurface(row: RawDomainRow): Surface {
  const namespace = row.subdomain && row.subdomain !== row.domain
    ? `${row.subdomain}.${row.domain}`
    : row.domain;
  const sslMode = String(row.sslMode || '').trim().toLowerCase();
  const httpsCapable = !!sslMode && sslMode !== 'off' && sslMode !== 'none';
  return {
    namespace,
    kind: 'public',
    endpoint: row.target || undefined,
    online: true,
    trust: undefined,
    lastSeenMs: undefined,
    // httpsCapable isn't part of the canonical Surface shape (yet) -- kept
    // out rather than guessed into `kind`/`online`, which mean something
    // more specific than "has a cert".
  };
}

export interface MeNetgetClient {
  domains(): Promise<Surface[]>;
  addresses(): Promise<Surface[]>;
  openResty(): Promise<Surface & { mode?: string; detail?: string }>;
}

export function createMeNetgetClient(baseUrl = 'http://local.netget'): MeNetgetClient {
  async function fetchJson<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  return {
    async domains() {
      const data = await fetchJson<{ domains: RawDomainRow[] }>('/domains');
      return Array.isArray(data?.domains) ? data.domains.map(domainRowToSurface) : [];
    },

    async addresses() {
      const controlSurfaces: Surface[] = BASE_SURFACES.map((namespace) => ({
        namespace,
        kind: 'netget',
        online: true,
      }));
      const controlNames = new Set(controlSurfaces.map((s) => s.namespace));
      const domainSurfaces = await this.domains();
      const realDomains = domainSurfaces.filter((s) => !controlNames.has(s.namespace));
      return [...controlSurfaces, ...realDomains];
    },

    async openResty() {
      const data = await fetchJson<RawOpenRestyStatus>('/openresty-status');
      if (!data) {
        return { namespace: 'openresty', kind: 'netget', online: false, detail: 'unreachable' };
      }
      return {
        namespace: 'openresty',
        kind: 'netget',
        online: !!data.ok && (!!data.httpListening || !!data.httpsListening),
        mode: data.mode,
        detail: data.detail || data.message,
      };
    },
  };
}
