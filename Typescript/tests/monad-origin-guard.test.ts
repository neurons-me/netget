import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Permanent coverage for src/kernel/testing/monadOriginGuard.ts itself —
// the mechanism every disposable-monad test (domain-store-dotted-domains,
// domain-map-ssl-inclusion, certbot-dns-google, certbot-provisioning,
// migrate-legacy-domains) and the claim-harness now rely on to stop a
// request from ever reaching anything but their own disposable monad.
//
// Runs the guard in a REAL child process (not just an in-process assert)
// against two REAL local HTTP servers, one "allowed" and one "forbidden" —
// so this proves two things an in-process check can't: (1) the forbidden
// server receives ZERO requests, not just that a promise rejected — the
// block genuinely happens before anything is sent, not after a failed
// round trip; (2) the whole process exits non-zero even though the
// subprocess's own code catches and swallows the forbidden request's
// rejection, exactly the shape of this codebase's own `.catch(() => {})`
// cleanup calls, which is what a violation actually has to survive to be
// a real guarantee rather than a convention someone can accidentally
// bypass.
//
// No monad, no NETGET_DATA_DIR, no real gateway involved anywhere here.

const execFileAsync = promisify(execFile);

function startSentinel(): Promise<{ origin: string; count: () => number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    let count = 0;
    const server = http.createServer((_req, res) => {
      count += 1;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('sentinel server did not report a numeric port'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        count: () => count,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

const allowed = await startSentinel();
const forbidden = await startSentinel();

const here = path.dirname(fileURLToPath(import.meta.url));
const subprocessPath = path.join(here, '_fixtures/monadOriginGuardSubprocess.ts');

try {
  let exitCode: number | null = 0;
  try {
    await execFileAsync('npx', ['tsx', subprocessPath], {
      env: { ...process.env, ALLOWED_ORIGIN: allowed.origin, FORBIDDEN_ORIGIN: forbidden.origin },
    });
  } catch (error: any) {
    exitCode = typeof error?.code === 'number' ? error.code : 1;
  }

  assert.notEqual(exitCode, 0, 'the guard must fail the subprocess even though it swallowed the forbidden request\'s rejection');
  assert.equal(forbidden.count(), 0, 'the forbidden sentinel must receive ZERO requests -- the guard must block before sending, not just report after the fact');
  assert.equal(allowed.count(), 1, 'the allowed origin must still receive the one legitimate request -- the guard must not also block what it is supposed to allow');

  console.log('monad-origin-guard ok');
} finally {
  await allowed.close();
  await forbidden.close();
}
