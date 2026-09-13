// monadOriginGuardSubprocess.ts — run ONLY as a child process spawned by
// tests/monad-origin-guard.test.ts. Not a test itself: it installs the
// guard, makes one allowed request (must succeed) and one forbidden
// request whose rejection it deliberately swallows (must still fail the
// process at exit), then exits normally. The parent test is the one that
// asserts on this process's exit code and on what the sentinel servers
// actually received.

import { installMonadOriginGuard } from '../../src/kernel/testing/monadOriginGuard.ts';

const allowedOrigin = process.env.ALLOWED_ORIGIN;
const forbiddenOrigin = process.env.FORBIDDEN_ORIGIN;
if (!allowedOrigin || !forbiddenOrigin) {
  console.error('ALLOWED_ORIGIN and FORBIDDEN_ORIGIN must both be set');
  process.exit(2);
}

installMonadOriginGuard([allowedOrigin]);

// Allowed request: must go through untouched.
const res = await fetch(`${allowedOrigin}/`, { method: 'POST', body: 'hello' });
if (!res.ok) {
  console.error(`allowed request unexpectedly failed with status ${res.status}`);
  process.exit(3);
}

// Forbidden request: guard must block it before it is ever sent. The
// rejection is deliberately swallowed here, matching this codebase's own
// `.catch(() => {})` cleanup style, to prove the guard's exit handler
// fails the process independently of whether the caller notices.
try {
  await fetch(`${forbiddenOrigin}/`, { method: 'POST', body: 'sabotage' });
} catch {
  // deliberately swallowed
}

console.log('subprocess finished normally (exit code, if non-zero, comes from the guard\'s own exit handler)');
