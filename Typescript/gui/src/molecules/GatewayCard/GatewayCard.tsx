// GatewayCard — displays the gateway's resolved .me identity.
// Reads from gateway-claims.json (materialized snapshot, never re-derives at runtime).
// No auth required — nginx enforces local.netget is loopback-only.

import * as React from 'react';
import { Card, Typography, Box, Chip } from 'this.gui/atoms';
import HashLabel from '../../atoms/HashLabel/HashLabel';

export interface GatewayCardProps {
  /** Gateway ID; absent when not reported by the server. */
  gatewayId?: string;
  /** Identity hash of the owner. null: the gateway reports no owner. undefined: not reported. */
  owner?: string | null;
  /** Whether the gateway has been claimed; absent means not reported. */
  bootstrapped?: boolean;
  /** Number of admin identities registered */
  adminCount?: number;
  /** Scopes granted to the owner; absent means not reported (not an empty list). */
  scopes?: string[];
  /** ISO date of the last claim snapshot update */
  updatedAt?: string | null;
  /** IP address nginx is listening on */
  ip?: string;
  /** Port nginx is listening on */
  port?: number;
  /** Scheme (http or https) */
  scheme?: string;
}

export default function GatewayCard({
  gatewayId,
  owner,
  bootstrapped,
  adminCount,
  scopes,
  updatedAt,
  ip,
  port,
  scheme = 'https',
}: GatewayCardProps) {
  return (
    <Card
      variant="outlined"
      sx={{ p: 3, minWidth: 320 }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
          {gatewayId?.trim() || 'Gateway ID unavailable'}
        </Typography>
        <Chip
          label={bootstrapped === true ? 'bootstrapped' : bootstrapped === false ? 'unclaimed' : 'Claim status unavailable'}
          color={bootstrapped === true ? 'success' : bootstrapped === false ? 'warning' : 'default'}
          size="small"
          variant={bootstrapped ? 'filled' : 'outlined'}
        />
      </Box>

      {/* Owner */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" sx={{ opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Owner
        </Typography>
        <HashLabel hash={owner ?? ''} fallback={owner === undefined ? 'Owner unavailable' : 'not set'} sx={{ mt: 0.25 }} />
      </Box>

      {/* Network row — IP + port */}
      {(ip || port) && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" sx={{ opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Listening on
          </Typography>
          <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace', mt: 0.25 }}>
            {scheme}://{ip}{port && port !== 443 && port !== 80 ? `:${port}` : ''}
          </Typography>
        </Box>
      )}

      {/* Stats row */}
      <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="caption" sx={{ opacity: 0.55 }}>Admins</Typography>
          <Typography variant="body2" fontWeight={600}>{adminCount ?? 'Not available'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ opacity: 0.55 }}>Scopes</Typography>
          <Typography variant="body2" fontWeight={600}>{scopes === undefined ? 'Not available' : scopes.length}</Typography>
        </Box>
      </Box>

      {/* Scopes */}
      {scopes !== undefined && scopes.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1.5 }}>
          {scopes.map((s) => (
            <Chip key={s} label={s} size="small" variant="outlined" color="default" />
          ))}
        </Box>
      )}

      {/* Footer: updatedAt */}
      {updatedAt && (
        <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.4 }}>
          snapshot: {new Date(updatedAt).toLocaleString()}
        </Typography>
      )}
    </Card>
  );
}

GatewayCard.displayName = 'Netget.GatewayCard';
