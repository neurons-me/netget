// identityView.ts -- turns a /gateway-identity body into what GatewayCard shows.
//
// A successful response can omit facts, and an omitted fact is not a negative one: a missing adminCount is
// not zero, a missing `bootstrapped` is not "unclaimed", a missing owner is not "no owner". Each field is
// therefore either a well-formed value or `undefined` ("not reported"); only the card decides how to say so.
// `owner: null` is different from a missing owner: the gateway said it has none.

import type { GatewayCardProps } from '../../molecules/GatewayCard/GatewayCard';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function gatewayCardPropsFromIdentity(body: unknown): GatewayCardProps {
  const d = asRecord(body);
  const gatewayId = typeof d.gatewayId === 'string' && d.gatewayId.trim() ? d.gatewayId : undefined;
  const owner = typeof d.owner === 'string' && d.owner.trim() ? d.owner : d.owner === null ? null : undefined;
  const bootstrapped = typeof d.bootstrapped === 'boolean' ? d.bootstrapped : undefined;
  const adminCount = Number.isInteger(d.adminCount) && (d.adminCount as number) >= 0 ? (d.adminCount as number) : undefined;
  const scopes = Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === 'string') : undefined;
  return {
    gatewayId,
    owner,
    bootstrapped,
    adminCount,
    scopes,
    updatedAt: (d.updatedAt as GatewayCardProps['updatedAt']) ?? null,
    ip: (d.ip as string | undefined) ?? undefined,
    port: (d.port as number | undefined) ?? undefined,
    scheme: (d.scheme as string | undefined) ?? 'https',
  };
}
