// HashLabel — truncates a cryptographic hash for display.
// Shows first N + last M chars with an ellipsis in between.
// Suitable for identityHash, gatewayId, publicKey fingerprints.

import * as React from 'react';
import { Typography } from 'this.gui/atoms';
import type { TypographyProps } from 'this.gui/atoms';

export interface HashLabelProps {
  /** Full hash string (hex, base58, or any long opaque identifier) */
  hash: string;
  /** Chars to show at the start (default 10) */
  prefixLen?: number;
  /** Chars to show at the end (default 6) */
  suffixLen?: number;
  /** Falls back to "–" when hash is empty/null */
  fallback?: string;
  variant?: TypographyProps['variant'];
  sx?: TypographyProps['sx'];
  /** Show full hash on title hover */
  showTitle?: boolean;
}

function truncate(hash: string, prefix: number, suffix: number): string {
  if (hash.length <= prefix + suffix + 3) return hash;
  return `${hash.slice(0, prefix)}…${hash.slice(-suffix)}`;
}

export default function HashLabel({
  hash,
  prefixLen = 10,
  suffixLen = 6,
  fallback = '–',
  variant = 'body2',
  sx,
  showTitle = true,
}: HashLabelProps) {
  if (!hash) {
    return (
      <Typography variant={variant} sx={{ opacity: 0.5, fontFamily: 'monospace', ...sx }}>
        {fallback}
      </Typography>
    );
  }

  return (
    <Typography
      variant={variant}
      title={showTitle ? hash : undefined}
      sx={{ fontFamily: 'monospace', letterSpacing: '0.02em', ...sx }}
    >
      {truncate(hash, prefixLen, suffixLen)}
    </Typography>
  );
}

HashLabel.displayName = 'Netget.HashLabel';
