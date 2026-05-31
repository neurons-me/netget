// MonadMesh — live grid of all registered monads.
// Polls /apps every pollMs milliseconds (default 5000).
// Renders MonadCards; empty state handled inline.
//
// This is the only compound that fetches data — everything else is pure display.

import * as React from 'react';
import { Box, Typography } from 'this.gui/atoms';
import MonadCard, { MonadCardProps } from '../../molecules/MonadCard/MonadCard';
import type { TrustLevel }     from '../../atoms/TrustBadge/TrustBadge';
import type { ExposureLevel }  from '../../atoms/ExposureChip/ExposureChip';

// ─── API types (mirrors apps.json schema) ─────────────────────────────────────
export interface MonadEntry {
  id?:         string;
  name:        string;
  port:        number;
  trust:       TrustLevel;
  exposure:    ExposureLevel;
  lastSeenMs?: number;
  ttlMs?:      number;
}

export interface MonadMeshProps {
  /** Override the apps endpoint (default: '/apps') */
  endpoint?: string;
  /** Polling interval in ms (default: 5000) */
  pollMs?: number;
  /** Called when a MonadCard is clicked */
  onMonadClick?: (monad: MonadEntry) => void;
}

export default function MonadMesh({
  endpoint = '/apps',
  pollMs = 5000,
  onMonadClick,
}: MonadMeshProps) {
  const [monads, setMonads]   = React.useState<MonadEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);

  const fetchMonads = React.useCallback(async () => {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setMonads(Array.isArray(data.apps) ? data.apps : []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  React.useEffect(() => {
    fetchMonads();
    const id = setInterval(fetchMonads, pollMs);
    return () => clearInterval(id);
  }, [fetchMonads, pollMs]);

  if (loading) {
    return (
      <Typography variant="body2" sx={{ opacity: 0.5, p: 2 }}>
        Loading monad mesh…
      </Typography>
    );
  }

  if (error) {
    return (
      <Typography variant="body2" color="error" sx={{ p: 2 }}>
        {error}
      </Typography>
    );
  }

  if (monads.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', opacity: 0.5 }}>
        <Typography variant="body2">No live monads registered.</Typography>
        <Typography variant="caption">
          Start a monad and call netget.registerApp() to appear here.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 2,
      }}
    >
      {monads.map((m, i) => (
        <MonadCard
          key={m.id ?? `${m.name}:${m.port}:${i}`}
          name={m.name}
          port={m.port}
          trust={m.trust ?? 'guest'}
          exposure={m.exposure ?? 'loopback'}
          lastSeenMs={m.lastSeenMs}
          onClick={onMonadClick ? () => onMonadClick(m) : undefined}
        />
      ))}
    </Box>
  );
}

MonadMesh.displayName = 'Netget.MonadMesh';
