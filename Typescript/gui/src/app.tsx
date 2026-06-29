// app.tsx — production SPA entry for local.netget admin UI
// Layout: .me identity (left) + namespace / monad.ai (right).
//   cleaker(me, namespace) reads left → right.
// .me card: orb first screen → click → Cleaker expands in-place → × → back to orb.
// Built by: npm run build:app  →  ../assets/main-server-ui/dist/

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme, Layout, Monad, Cleaker, MonadNamespaceCard } from 'this.gui';
import { Box, Typography } from 'this.gui/atoms';
// Material Symbols font — must be imported explicitly so Vite emits the .woff2 asset.
// Without this the Icon component renders icon names as literal text.
import 'this.gui/material-symbols.css';

// ─── /apps registry types ────────────────────────────────────────────────────

interface AppHealth {
  state: 'healthy' | 'unhealthy' | string;
  updatedAt?: string;
}

interface AppEntry {
  name: string;
  port: number;
  kind: string;
  hostname?: string;     // os.hostname() — e.g. "suis-macbook-air.local"
  health?: AppHealth;
  exposure?: {
    inbound?: { paths?: string[] };
  };
}

interface AppsResponse {
  count: number;
  apps: AppEntry[];
}

// ─── Gateway session types ────────────────────────────────────────────────────

type GatewayStatus = 'idle' | 'checking' | 'ok' | 'error' | 'not-bootstrapped';

interface GatewaySession {
  authenticated: boolean;
  identityHash: string;
  gatewayId: string;
  isOwner: boolean;
  isAdmin: boolean;
  scopes: string[];
  error: string | null;
  status: GatewayStatus;
}

const GATEWAY_SESSION_INIT: GatewaySession = {
  authenticated: false,
  identityHash: '',
  gatewayId: '',
  isOwner: false,
  isAdmin: false,
  scopes: [],
  error: null,
  status: 'idle',
};

// ─── Hook: restart all monads ────────────────────────────────────────────────

function useRestartAllMonads() {
  const [status, setStatus] = React.useState<'idle' | 'restarting' | 'ok' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const restart = React.useCallback(async () => {
    setStatus('restarting');
    setError(null);
    try {
      const res = await fetch('/apps/restart-all', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).message ?? `Error ${res.status}`);
      }
      setStatus('ok');
      window.setTimeout(() => setStatus('idle'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
      window.setTimeout(() => setStatus('idle'), 4000);
    }
  }, []);

  return { status, error, restart };
}

// ─── Hook: poll /apps ────────────────────────────────────────────────────────

function useNetgetApps(pollMs = 5000) {
  const [apps, setApps] = React.useState<AppEntry[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ok' | 'error'>('loading');

  React.useEffect(() => {
    let cancelled = false;

    async function fetch_() {
      try {
        const res = await fetch('/apps', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`${res.status}`);
        const data: AppsResponse = await res.json();
        if (!cancelled) {
          setApps(Array.isArray(data.apps) ? data.apps : []);
          setStatus('ok');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    fetch_();
    const id = setInterval(fetch_, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);

  return { apps, status };
}

function isHealthy(app: AppEntry) {
  return app.health?.state === 'healthy';
}

// ─── Hook: monad catalog ─────────────────────────────────────────────────────

interface CatalogEntry {
  name: string;
  cmd: string;
  cwd: string;
  autoStart: boolean;
}

function useMonadCatalog(pollMs = 10000) {
  const [catalog, setCatalog] = React.useState<CatalogEntry[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/apps/catalog');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.catalog)) setCatalog(data.catalog);
      } catch {}
    }
    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);

  return catalog;
}

function useWakeMonad() {
  const [waking, setWaking] = React.useState<Record<string, boolean>>({});

  const wake = React.useCallback(async (name: string) => {
    setWaking(prev => ({ ...prev, [name]: true }));
    try {
      await fetch('/apps/catalog/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch {}
    window.setTimeout(() => setWaking(prev => ({ ...prev, [name]: false })), 6000);
  }, []);

  return { waking, wake };
}

// ─── Hook: gateway identity (IP, port, scheme) ───────────────────────────────

interface GatewayIdentity {
  ip?: string;
  port?: number;
  scheme?: string;
  bootstrapped?: boolean;
}

function useGatewayIdentity() {
  const [identity, setIdentity] = React.useState<GatewayIdentity | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/gateway-identity');
        if (!res.ok) return;
        const data = await res.json();
        setIdentity({
          ip:           typeof data.ip     === 'string' ? data.ip     : undefined,
          port:         typeof data.port   === 'number' ? data.port   : undefined,
          scheme:       typeof data.scheme === 'string' ? data.scheme : undefined,
          bootstrapped: Boolean(data.bootstrapped),
        });
      } catch {}
    })();
  }, []);

  return identity;
}

// ─── Hook: gateway claims ────────────────────────────────────────────────────

interface ClaimIdentity {
  hash: string;
  short: string;
  username: string | null;
  role?: 'owner' | 'admin' | 'identity';
  isOwner?: boolean;
  isAdmin?: boolean;
}

interface GatewayClaims {
  claimed: boolean;
  gatewayId: string;
  owner: ClaimIdentity | null;
  admins: ClaimIdentity[] | Record<string, never>;
  identities?: ClaimIdentity[];
  total: number;
}

function useGatewayClaims(pollMs = 8000) {
  const [claims, setClaims] = React.useState<GatewayClaims | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/me/claims');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setClaims(data as GatewayClaims);
      } catch {}
    }

    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);

  return claims;
}

// ─── Hook: gateway auth ───────────────────────────────────────────────────────
//
// Stateless model ("sello digital"):
//   - Identity lives in React state only — no cookies, no JWT.
//   - Cleaker does signed /check-auth via X-Me-Proof, then fires the event.
//   - We read the session from the event detail — no second network call.
//   - "Logout" = identity drops from memory when Cleaker closes.

function useGatewayAuth() {
  const [session, setSession] = React.useState<GatewaySession>(GATEWAY_SESSION_INIT);

  // ── Listen for Cleaker gateway-pre-auth event ─────────────────────────────
  // Fired by useCleakerAuth after a successful signed /check-auth.
  // Event detail carries the full session fields returned by /check-auth.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const identityHash = String(detail.identityHash || '').trim();
      if (!identityHash || !/^[0-9a-f]{64}$/.test(identityHash)) return;

      setSession({
        authenticated: true,
        identityHash,
        gatewayId: String(detail.gatewayId  || ''),
        isOwner:   Boolean(detail.isOwner),
        isAdmin:   Boolean(detail.isAdmin),
        scopes:    Array.isArray(detail.scopes) ? detail.scopes : [],
        status:    'ok',
        error:     null,
      });
    };

    window.addEventListener('cleaker:gateway-pre-auth', handler);
    return () => window.removeEventListener('cleaker:gateway-pre-auth', handler);
  }, []);

  return session;
}

// ─── GatewayStatus chip ───────────────────────────────────────────────────────

function GatewayStatusChip({ session }: { session: GatewaySession }) {
  if (session.status === 'checking') {
    return (
      <Box sx={{ fontSize: '11px', color: 'text.secondary', fontFamily: 'monospace', opacity: 0.6 }}>
        authenticating…
      </Box>
    );
  }
  if (session.status === 'ok' && session.authenticated) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '11px', fontFamily: 'monospace' }}>
        <Box
          sx={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}
          title="Gateway authenticated"
        />
        <Box sx={{ color: 'text.secondary', opacity: 0.75 }}>
          {session.isOwner ? 'owner' : session.isAdmin ? 'admin' : 'identity'}
          {session.gatewayId ? ` · ${session.gatewayId}` : ''}
        </Box>
      </Box>
    );
  }
  if (session.status === 'not-bootstrapped') {
    return (
      <Box sx={{ fontSize: '11px', color: 'warning.main', fontFamily: 'monospace', opacity: 0.8 }}>
        run `netget claim` to set up gateway
      </Box>
    );
  }
  if (session.status === 'error' && session.error) {
    return (
      <Box sx={{ fontSize: '11px', color: 'error.main', fontFamily: 'monospace', opacity: 0.85 }}>
        {session.error}
      </Box>
    );
  }
  return null;
}

// ─── AdminApp ─────────────────────────────────────────────────────────────────

function AdminApp() {
  const { apps } = useNetgetApps(5000);
  const [meOpen, setMeOpen] = React.useState(false);
  const gateway       = useGatewayAuth();
  const identity      = useGatewayIdentity();
  const gatewayClaims = useGatewayClaims();
  const restartAll    = useRestartAllMonads();
  const catalog       = useMonadCatalog();
  const { waking, wake } = useWakeMonad();

  // Root namespace = the machine's os.hostname(), reported by every registered app
  const machineHostname = apps[0]?.hostname ?? window.location.hostname;
  const meshHealthy = apps.length > 0 ? apps.some(isHealthy) : null;

  // Merge live apps + catalog entries — catalog names that have no live app are "sleeping"
  const liveNames = new Set(apps.map(a => (a.name || '').replace(/^monad:/, '').toLowerCase()));
  const sleepingEntries = catalog.filter(e => !liveNames.has(e.name.toLowerCase()));
  const claimRows = React.useMemo<ClaimIdentity[]>(() => {
    if (!gatewayClaims?.claimed) return [];
    if (Array.isArray(gatewayClaims.identities) && gatewayClaims.identities.length > 0) {
      return gatewayClaims.identities;
    }
    const rows: ClaimIdentity[] = [];
    if (gatewayClaims.owner) rows.push({ ...gatewayClaims.owner, role: 'owner', isOwner: true });
    if (Array.isArray(gatewayClaims.admins)) {
      for (const admin of gatewayClaims.admins) {
        if (!rows.some(row => row.hash === admin.hash)) rows.push({ ...admin, role: 'admin', isAdmin: true });
      }
    }
    return rows;
  }, [gatewayClaims]);

  // Shared card shell styles
  const cardSx = {
    position: 'relative' as const,
    width: '100%',
    borderRadius: 3,
    border: '1px solid',
    borderColor: 'divider',
    background: 'background.paper',
    overflow: 'hidden',
  };

  return (
    <Layout TopBar={false} Footer={false}>
      <Box sx={{ p: 4, maxWidth: 960, mx: 'auto', width: '100%' }}>

        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 0.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              NetGet
            </Typography>
            {/* Gateway auth status inline in header */}
            <GatewayStatusChip session={gateway} />
          </Box>
          {identity?.ip ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ opacity: 0.35, fontFamily: 'monospace' }}>
                {identity.scheme}://{identity.ip}
              </Typography>
              {[80, 443].map(p => (
                <Box
                  key={p}
                  sx={{
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    px: 0.75,
                    py: 0.15,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    opacity: 0.3,
                    lineHeight: 1.6,
                  }}
                >
                  :{p}
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ opacity: 0.35, fontFamily: 'monospace' }}>
              {machineHostname}
            </Typography>
          )}
        </Box>

        {/* .me first, namespace second — cleaker(me, namespace) reads left → right */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 4,
            alignItems: 'start',
          }}
        >

          {/* ── .me — user identity surface ──────────────────────────────────── */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="overline" sx={{ opacity: 0.4, letterSpacing: '0.1em' }}>
              .me
            </Typography>

            {/* Orb screen — collapsed state */}
            {!meOpen && (
              <Box
                onClick={() => setMeOpen(true)}
                sx={{
                  ...cardSx,
                  height: 220,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <Monad
                  mode="contained"
                  kind="me"
                  label=".me"
                  healthy={gateway.authenticated ? true : null}
                />
              </Box>
            )}

            {/* Cleaker screen — expanded state, mounts only when open */}
            {meOpen && (
              <Box sx={cardSx}>
                {/* Card header with close button */}
                <Box
                  sx={{
                    px: 2,
                    py: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {/* Mini orb dot */}
                    <Box
                      sx={{
                        fontSize: 13,
                        lineHeight: 1,
                        opacity: 0.6,
                        userSelect: 'none',
                      }}
                    >
                      ⊙
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.45, fontFamily: 'monospace' }}>
                      {machineHostname}
                    </Typography>
                  </Box>

                  {/* Back to orb */}
                  <Box
                    onClick={() => setMeOpen(false)}
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: 16,
                      opacity: 0.4,
                      border: '1px solid',
                      borderColor: 'divider',
                      userSelect: 'none',
                      '&:hover': { opacity: 1, borderColor: 'primary.main' },
                    }}
                  >
                    ×
                  </Box>
                </Box>

                {/* Cleaker — mounts fresh each time, no background preview events */}
                <Box sx={{ p: 1 }}>
                  <Cleaker namespace={machineHostname} maxWidth="100%" />
                </Box>

                {/* Gateway auth status below Cleaker when checking/error */}
                {(gateway.status === 'checking' || gateway.status === 'error' || gateway.status === 'not-bootstrapped') && (
                  <Box
                    sx={{
                      px: 2,
                      pb: 1.5,
                      pt: 0.5,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <GatewayStatusChip session={gateway} />
                  </Box>
                )}

                {/* Success banner — shown briefly after auth */}
                {gateway.status === 'ok' && gateway.authenticated && (
                  <Box
                    sx={{
                      px: 2,
                      pb: 1.25,
                      pt: 0.75,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <Box
                      sx={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}
                    />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.6 }}>
                      {gateway.isOwner ? 'Gateway owner authenticated' : gateway.isAdmin ? 'Gateway admin authenticated' : 'Gateway identity authenticated'}
                      {gateway.scopes.length > 0 ? ` · scopes: ${gateway.scopes.join(', ')}` : ''}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </Box>

          {/* ── namespace surface ─────────────────────────────────────────────── */}
          <MonadNamespaceCard
            namespace={machineHostname}
            healthy={meshHealthy}
            claimed={Boolean(gatewayClaims?.claimed)}
            claimRows={claimRows}
            apps={apps.map(app => ({ name: app.name, port: app.port, healthy: isHealthy(app) }))}
            sleepingEntries={sleepingEntries}
            waking={waking}
            onWake={wake}
            restartStatus={restartAll.status}
            restartError={restartAll.error}
            onRestartAll={restartAll.restart}
          />


        </Box>
      </Box>
    </Layout>
  );
}

// ─── Mount ───────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Theme initialMode="dark">
      <AdminApp />
    </Theme>
  </React.StrictMode>,
);
