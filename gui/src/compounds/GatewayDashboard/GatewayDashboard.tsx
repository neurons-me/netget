// GatewayDashboard — top-level compound for local.netget home view.
// Combines gateway identity + live monad mesh in one fetching surface.
// Polls /gateway-identity and /apps in parallel.

import * as React from 'react';
import { Box, Typography } from 'this.gui/atoms';
import GatewayCard, { GatewayCardProps } from '../../molecules/GatewayCard/GatewayCard';
import MonadMesh from '../MonadMesh/MonadMesh';
import type { MonadEntry } from '../MonadMesh/MonadMesh';

export interface GatewayDashboardProps {
  /** Override gateway-identity endpoint (default: '/gateway-identity') */
  identityEndpoint?: string;
  /** Override apps endpoint (default: '/apps') */
  appsEndpoint?: string;
  /** Polling interval for monad mesh in ms (default: 5000) */
  pollMs?: number;
  /** Called when a MonadCard is clicked */
  onMonadClick?: (monad: MonadEntry) => void;
}

type IdentityState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: GatewayCardProps };

export default function GatewayDashboard({
  identityEndpoint = '/gateway-identity',
  appsEndpoint     = '/apps',
  pollMs           = 5000,
  onMonadClick,
}: GatewayDashboardProps) {
  const [identity, setIdentity] = React.useState<IdentityState>({ status: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(identityEndpoint);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!cancelled) {
          setIdentity({
            status: 'ready',
            data: {
              gatewayId:   data.gatewayId   ?? 'unknown',
              owner:       data.owner       ?? null,
              bootstrapped: !!data.bootstrapped,
              adminCount:  data.adminCount  ?? 0,
              scopes:      Array.isArray(data.scopes) ? data.scopes : [],
              updatedAt:   data.updatedAt   ?? null,
            },
          });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setIdentity({ status: 'error', message: e instanceof Error ? e.message : 'fetch failed' });
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [identityEndpoint]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Gateway Identity */}
      <Box>
        <Typography
          variant="overline"
          sx={{ opacity: 0.5, letterSpacing: '0.1em', display: 'block', mb: 1.5 }}
        >
          Gateway Identity
        </Typography>
        {identity.status === 'loading' && (
          <Typography variant="body2" sx={{ opacity: 0.5 }}>Loading identity…</Typography>
        )}
        {identity.status === 'error' && (
          <Typography variant="body2" color="error">{identity.message}</Typography>
        )}
        {identity.status === 'ready' && (
          <GatewayCard {...identity.data} />
        )}
      </Box>

      {/* Monad Mesh */}
      <Box>
        <Typography
          variant="overline"
          sx={{ opacity: 0.5, letterSpacing: '0.1em', display: 'block', mb: 1.5 }}
        >
          Monad Mesh
        </Typography>
        <MonadMesh
          endpoint={appsEndpoint}
          pollMs={pollMs}
          onMonadClick={onMonadClick}
        />
      </Box>
    </Box>
  );
}

GatewayDashboard.displayName = 'Netget.GatewayDashboard';
