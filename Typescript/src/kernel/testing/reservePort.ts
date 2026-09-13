// reservePort.ts — hand a caller a concrete, currently-free TCP port
// BEFORE it starts anything, so it can commit to an exact expected origin
// up front (e.g. arm a request guard for that exact origin) instead of
// discovering the origin only after something else has already chosen it.
//
// Binds to port 0 (OS picks a free ephemeral port), reads the port back,
// then closes immediately. There is an inherent, unavoidable TOCTOU gap
// between this close and whatever the caller does with the number next —
// nothing in userspace can fully close it — but it is far smaller than
// "start a whole monad process, then ask it afterward what port it used,"
// and the caller (netgetMonadProcess.ts's startNetgetMonad({ port })) is
// itself given the reserved port explicitly rather than picking its own,
// so a guard armed with this number is protecting the actual value that
// will be requested, not a guess.

import net from 'node:net';

/**
 * Reserves a free port. If `preferredPort` is given and available, returns
 * that exact port (mirrors monad.ai's own findFreePort(preferred) — used
 * by callers like the claim harness that want a STABLE port across
 * restarts when the previously-used one is still free, rather than
 * drifting to a new random port every run); otherwise falls back to any
 * free ephemeral port.
 */
export function reservePort(preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (preferredPort && err.code === 'EADDRINUSE') {
        resolve(reservePort());
        return;
      }
      reject(err);
    });
    srv.listen(preferredPort ?? 0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close();
        reject(new Error('reservePort: could not read back a numeric port'));
        return;
      }
      const { port } = address;
      srv.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(port);
      });
    });
  });
}
