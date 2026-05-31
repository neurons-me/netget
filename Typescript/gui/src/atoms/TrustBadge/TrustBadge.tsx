// TrustBadge — displays the trust level of a monad relative to the gateway owner.
//
// Trust levels (from .me kernel):
//   owner   — the identity hash that owns this gateway (bootstrapped)
//   admin   — explicitly granted admin scope
//   peer    — recognized peer (signed handshake)
//   guest   — unauthenticated / unknown
//
// Color mapping follows MUI severity semantics so it's visually self-documenting.

import * as React from 'react';
import { Chip } from 'this.gui/atoms';
import type { ChipProps } from 'this.gui/atoms';

export type TrustLevel = 'owner' | 'admin' | 'peer' | 'guest';

export interface TrustBadgeProps {
  trust: TrustLevel;
  size?: ChipProps['size'];
}

const TRUST_COLOR: Record<TrustLevel, ChipProps['color']> = {
  owner: 'success',   // green — highest trust
  admin: 'primary',   // blue  — elevated
  peer:  'info',      // teal  — known
  guest: 'warning',   // amber — unknown
};

const TRUST_LABEL: Record<TrustLevel, string> = {
  owner: 'owner',
  admin: 'admin',
  peer:  'peer',
  guest: 'guest',
};

export default function TrustBadge({ trust, size = 'small' }: TrustBadgeProps) {
  return (
    <Chip
      label={TRUST_LABEL[trust]}
      color={TRUST_COLOR[trust]}
      size={size}
      variant="filled"
    />
  );
}

TrustBadge.displayName = 'Netget.TrustBadge';
