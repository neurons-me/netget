// comingSoon.js -- the rules of the "On Development / Coming Soon" curtain (pure, so they can be tested without a browser).
//
// It is a CURTAIN, not access control: the code is in the page the visitor downloads, so anyone who reads the bundle can
// open it. It keeps the unfinished site from being walked into by accident and lets the owner in for tests. Real
// restriction would be a check on the server.
export const CURTAIN_CODE = '160490';
export const CURTAIN_KEY = 'neurons:coming-soon:unlocked';
// The public sites. A host matches itself and any subdomain (`alice.cleaker.me`). Not localhost, not an IP, not `.local`.
export const CURTAIN_HOSTS = ['cleaker.me', 'netget.site'];

export function isCurtainHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return CURTAIN_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** `?curtain=on` shows it on any host (to see/test it); `?curtain=reset` also forgets that this browser was let in. */
export function curtainOverride(search) {
  const v = new URLSearchParams(String(search || '')).get('curtain');
  return v === 'on' || v === 'reset' ? v : null;
}

export function acceptsCode(input) {
  return String(input ?? '').trim() === CURTAIN_CODE;
}

/**
 * Is the curtain closed for this visitor? `unlocked` is what this browser remembers NOW: once the code has been accepted
 * it wins over everything (`?curtain=reset` only clears what was remembered, once, when the page loads: see ComingSoonGate).
 */
export function curtainClosed({ hostname, search, unlocked }) {
  if (unlocked) return false;
  if (curtainOverride(search)) return true;
  return isCurtainHost(hostname);
}
