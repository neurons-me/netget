// resolveNetgetSeed.js — wires netget's own credentials (the same
// username+secret UnlockDialog used to sign gateway proofs with) into a
// real monad-backed .me session, via this.gui's SeedSessionProvider.
//
// Same identity math as deriveCleakerNode() (this.gui/cleaker) — see
// signedRequest.ts's deriveCompoundSeed doc comment. This does not add a
// second identity system; it opens an actual kernel session for the one
// that already exists, so the rest of the app (MeLauncher, Domains.jsx) can
// share one session instead of each page deriving its own one-off node.
import { deriveCompoundSeed, fetchGatewayHostname, getActiveNamespaceRoot } from 'this.gui/cleaker';

// Mirrors modules/netget/Typescript/src/kernel/domainStore.ts's
// sanitizeOwnerLabel() exactly — must match, since the namespace claimed
// here (`${label}.${hostname}`) is what a future users.<owner>.* write
// check would key off of. Duplicated rather than imported: that file is a
// Node backend module (fs, monadHttpClient), not part of this browser
// bundle.
function sanitizeOwnerLabel(raw) {
  const safe = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return safe || 'owner';
}

// Passed as SeedSessionProvider's resolveSeedFromCredentials — return shape
// matches SeedCredentialResolution ({ seed, namespace }). loginWithSeed
// then claims+opens `<user>.<hostname>` automatically (first-login claim
// fallback lives in SeedSessionProvider itself, generalized from
// SessionSurface's own pattern).
//
// hostname resolution: a root explicitly picked by a switch-offering UI
// (CleakerLanding's local.cleaker/cleaker.me badge, via
// getActiveNamespaceRoot()) wins — whatever root is shown on screen is the
// root that gets claimed. Falls back to the physical gateway's own hostname
// (fetchGatewayHostname()) everywhere no such switch is in play, same as
// before this existed.
export async function resolveNetgetSeedFromCredentials({ username, password }) {
  const hostname = getActiveNamespaceRoot() || await fetchGatewayHostname();
  const seed = deriveCompoundSeed(String(username || '').trim(), password);
  const namespace = `${sanitizeOwnerLabel(username)}.${hostname}`;
  return { seed, namespace };
}

// netget's own monad, reached the same way any other app reaches its own —
// through netget's generic /apps/:name mesh proxy (monad_proxy.lua), not a
// dedicated port. It registers under the name "netget" automatically (see
// kernel/netgetMonadProcess.ts) — no dedicated nginx route needed, and the
// dev server gets the same shape via localNetget.js's /apps/netget/*
// passthrough.
export function netgetMonadTransportOrigin() {
  return `${window.location.origin}/apps/netget`;
}
