/**
 * installActionAuth.ts
 *
 * Authorization for the OpenResty install/progress routes specifically —
 * NOT a general-purpose admin middleware (none exists in this codebase
 * today; see localNetget.js's own header: routes there trust nginx's
 * loopback enforcement and have no per-route check, except
 * `/domains/metadata`, whose pattern this mirrors). These routes exist to
 * let the browser trigger a real install, so "reachable from localhost"
 * is deliberately NOT treated as authorization here, even though nothing
 * else in this file currently enforces that distinction either.
 *
 * Two eras, two different proofs, matching gatewaySetupSession.ts's own
 * split between "access to the install process" and "who owns this
 * gateway":
 *   - Before a claim exists: the caller must hold this run's setupToken
 *     (isSetupSessionActive — gatewaySetupSession.ts). Nothing else could
 *     prove authorization yet; there is no owner, no admin, no scopes.
 *   - After a claim exists: the caller must be a registered admin with the
 *     `gateway:write` scope, proven the same way /domains/metadata already
 *     proves it — X-Netget-Identity/X-Netget-Scopes, forwarded ONLY by
 *     nginx's me_sig.lua after it verifies a real signature (see
 *     setNginxConfigRoutes.ts). That means these routes are only genuinely
 *     authorized post-claim when reached THROUGH OpenResty, not by hitting
 *     the bootstrap port directly — a real, inherited limitation (every
 *     other admin-ish route in this codebase has the same gap), not
 *     something newly introduced here, and out of this task's scope to
 *     close.
 */

import { GatewayClaimsManager } from './GatewayClaimsManager.js';
import { isSetupSessionActive } from './gatewaySetupSession.js';

export interface MinimalRequest {
  header(name: string): string | undefined;
}

export type InstallActionAuthResult =
  | { ok: true; mode: 'setup' | 'admin' }
  | { ok: false; status: number; error: string };

export function checkInstallActionAuth(req: MinimalRequest): InstallActionAuthResult {
  const claims = new GatewayClaimsManager();

  if (!claims.hasOwner()) {
    const setupToken = String(req.header('x-netget-setup-token') || '').trim();
    if (!setupToken) {
      return { ok: false, status: 401, error: 'SETUP_TOKEN_REQUIRED' };
    }
    if (!isSetupSessionActive(setupToken)) {
      return { ok: false, status: 401, error: 'SETUP_SESSION_INACTIVE' };
    }
    return { ok: true, mode: 'setup' };
  }

  const identity = String(req.header('x-netget-identity') || '').trim();
  if (!identity) {
    return { ok: false, status: 401, error: 'IDENTITY_REQUIRED' };
  }
  let scopes: unknown;
  try {
    scopes = JSON.parse(req.header('x-netget-scopes') || '[]');
  } catch {
    scopes = [];
  }
  if (!Array.isArray(scopes) || !scopes.includes('gateway:write')) {
    return { ok: false, status: 403, error: 'CAPABILITY_DENIED' };
  }
  if (!claims.isAdmin(identity)) {
    return { ok: false, status: 403, error: 'NOT_AN_ADMIN' };
  }
  return { ok: true, mode: 'admin' };
}
