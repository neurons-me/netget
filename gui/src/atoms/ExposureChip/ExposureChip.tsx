// ExposureChip — displays the network reach of a monad.
//
// Exposure levels (from monad registration):
//   loopback — only reachable from this machine (127.0.0.1)
//   lan      — reachable on the local network
//   wan      — publicly reachable / internet-facing
//
// Trust and exposure are ORTHOGONAL — a guest monad can be lan-exposed,
// an owner monad can be loopback-only. Never conflate the two.

import * as React from 'react';
import { Chip } from 'this.gui/atoms';
import type { ChipProps } from 'this.gui/atoms';

export type ExposureLevel = 'loopback' | 'lan' | 'wan';

export interface ExposureChipProps {
  exposure: ExposureLevel;
  size?: ChipProps['size'];
}

const EXPOSURE_COLOR: Record<ExposureLevel, ChipProps['color']> = {
  loopback: 'default',  // grey  — local only
  lan:      'info',     // blue  — network-local
  wan:      'warning',  // amber — public facing
};

const EXPOSURE_LABEL: Record<ExposureLevel, string> = {
  loopback: 'loopback',
  lan:      'lan',
  wan:      'wan',
};

export default function ExposureChip({ exposure, size = 'small' }: ExposureChipProps) {
  return (
    <Chip
      label={EXPOSURE_LABEL[exposure]}
      color={EXPOSURE_COLOR[exposure]}
      size={size}
      variant="outlined"
    />
  );
}

ExposureChip.displayName = 'Netget.ExposureChip';
