/**
 * gatewayAdminActions.ts — netget's thin forwarding layer for grant/revoke/
 * transfer on a namespace-derived gateway.
 *
 * Netget performs NO signature verification and NO authorization decision
 * here — that would just recreate the unsigned-write problem this whole
 * mechanism exists to close. Each function: resolves which live monad
 * serves the ACTING identity's own namespace (the same `resolveSurface()`
 * every other real signed action in this codebase already uses — see
 * `gatewaySetupSession.ts`'s `commitSignedClaim`), forwards the
 * already-signed proof the caller (GUI) built to that monad's own
 * `claim/gatewayAuthority.ts` endpoint — which independently re-verifies
 * the signature AND checks the acting identity actually holds gateway
 * authority, never trusting netget's say-so — and on success refreshes the
 * local `gateway-claims.json` cache Lua reads
 * (`GatewayClaimsManager.materializeFromGatewayAuthority`).
 *
 * MVP scope note: this assumes the acting identity's own namespace and the
 * gateway's canonical `daemon.gateways.*` branch live on the SAME monad —
 * the real single-operator setup this session's harnesses already use
 * (`NETGET_MONAD_NAMESPACE` pointed directly at the operator's own claimed
 * namespace). A second admin on a genuinely different host/monad is future
 * work, not silently precluded but not solved here.
 */

import { resolveSurface } from '../../../kernel/topologyResolver.js';
import { GatewayClaimsManager } from './GatewayClaimsManager.js';

export interface SignedGatewayActionProof {
  gatewayId: string;
  namespace: string;
  actingKeyId: string;
  nonce: string;
  timestamp: number;
  signature: string;
  signedPayload?: string;
}

export interface GrantGatewayAdminProof extends SignedGatewayActionProof {
  targetIdentityHash: string;
  targetNamespace: string;
  targetPublicKey?: string | null;
  targetUsername?: string | null;
  scopes: string[];
}

export interface RevokeGatewayAdminProof extends SignedGatewayActionProof {
  targetIdentityHash: string;
}

export interface TransferGatewayOwnerProof extends SignedGatewayActionProof {
  targetIdentityHash: string;
}

export type GatewayActionResult =
  | { ok: true; message?: undefined }
  | { ok: false; message: string };

async function forwardSignedAction(
  gatewayId: string,
  namespace: string,
  path: string,
  body: Record<string, unknown>,
): Promise<GatewayActionResult> {
  const surface = await resolveSurface({ namespace });
  if (!surface) {
    return { ok: false, message: 'Could not find a live surface serving that namespace.' };
  }

  let responseBody: { ok?: boolean; error?: string } | null = null;
  try {
    const res = await fetch(`${surface.url.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    responseBody = await res.json().catch(() => null);
    if (!res.ok || !responseBody?.ok) {
      return { ok: false, message: responseBody?.error || `Action failed (${res.status}).` };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not reach the target surface.' };
  }

  const mgr = new GatewayClaimsManager(gatewayId, { ledger: false });
  await mgr.materializeFromGatewayAuthority(surface.url);
  return { ok: true };
}

export async function grantGatewayAdmin(proof: GrantGatewayAdminProof): Promise<GatewayActionResult> {
  return forwardSignedAction(proof.gatewayId, proof.namespace, `/api/v1/gateway/${encodeURIComponent(proof.gatewayId)}/admins`, {
    namespace: proof.namespace,
    actingKeyId: proof.actingKeyId,
    targetIdentityHash: proof.targetIdentityHash,
    targetNamespace: proof.targetNamespace,
    targetPublicKey: proof.targetPublicKey ?? null,
    targetUsername: proof.targetUsername ?? null,
    scopes: proof.scopes,
    nonce: proof.nonce,
    timestamp: proof.timestamp,
    signature: proof.signature,
    signedPayload: proof.signedPayload,
  });
}

export async function revokeGatewayAdmin(proof: RevokeGatewayAdminProof): Promise<GatewayActionResult> {
  return forwardSignedAction(
    proof.gatewayId,
    proof.namespace,
    `/api/v1/gateway/${encodeURIComponent(proof.gatewayId)}/admins/${encodeURIComponent(proof.targetIdentityHash)}/revoke`,
    {
      namespace: proof.namespace,
      actingKeyId: proof.actingKeyId,
      nonce: proof.nonce,
      timestamp: proof.timestamp,
      signature: proof.signature,
      signedPayload: proof.signedPayload,
    },
  );
}

export async function transferGatewayOwner(proof: TransferGatewayOwnerProof): Promise<GatewayActionResult> {
  return forwardSignedAction(proof.gatewayId, proof.namespace, `/api/v1/gateway/${encodeURIComponent(proof.gatewayId)}/transfer`, {
    namespace: proof.namespace,
    actingKeyId: proof.actingKeyId,
    targetIdentityHash: proof.targetIdentityHash,
    nonce: proof.nonce,
    timestamp: proof.timestamp,
    signature: proof.signature,
    signedPayload: proof.signedPayload,
  });
}
