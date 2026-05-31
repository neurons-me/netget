// MonadCard — displays a live monad from the netget mesh.
// Data comes from apps.json (materialized by the .me kernel on registration).
// No data fetching here — pure display molecule.

import * as React from 'react';
import { Card, Typography, Box } from 'this.gui/atoms';
import TrustBadge, { TrustLevel }     from '../../atoms/TrustBadge/TrustBadge';
import ExposureChip, { ExposureLevel } from '../../atoms/ExposureChip/ExposureChip';

export interface MonadCardProps {
  /** Monad name (registered module name) */
  name: string;
  /** Port the monad is running on */
  port: number;
  /** Trust level relative to gateway owner — from .me kernel */
  trust: TrustLevel;
  /** Network reach — from monad registration */
  exposure: ExposureLevel;
  /** Time the monad was last seen (ms epoch). Used to compute "X ago" label. */
  lastSeenMs?: number;
  /** Called when the card is clicked (e.g. navigate to /monads/:name) */
  onClick?: () => void;
}

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 5)  return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function MonadCard({
  name,
  port,
  trust,
  exposure,
  lastSeenMs,
  onClick,
}: MonadCardProps) {
  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        minWidth: 220,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
        '&:hover': onClick ? { borderColor: 'primary.main' } : {},
      }}
    >
      {/* Header: name + port */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ mr: 1 }}>
          {name}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.6, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          :{port}
        </Typography>
      </Box>

      {/* Badges: trust + exposure */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TrustBadge trust={trust} />
        <ExposureChip exposure={exposure} />
      </Box>

      {/* Footer: last seen */}
      {lastSeenMs != null && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1.5, opacity: 0.5 }}>
          {timeAgo(lastSeenMs)}
        </Typography>
      )}
    </Card>
  );
}

MonadCard.displayName = 'Netget.MonadCard';
