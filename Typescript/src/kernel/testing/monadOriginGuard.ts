// monadOriginGuard.ts — blocks, before it is ever sent, any outbound
// fetch() whose origin is not in an explicit allow-list.
//
// This is the second design, not the first. The first version armed
// itself only AFTER startNetgetMonad() resolved, because the exact
// disposable origin (the port monad.ai's findFreePort() picks) wasn't
// knowable any earlier — so it recorded pre-arm requests and validated
// them retroactively once the origin became known. That leaves a real
// window: retroactive validation confirms a wrong-destination request
// happened, it does not stop it from having already reached that
// destination. Reviewed correctly as insufficient — "prevención completa"
// requires blocking BEFORE the send, with no such window, full stop.
//
// This version requires the caller to know its exact expected origin(s)
// up front and pass them to install(). For the disposable-monad tests,
// that means reserving a concrete port first (reservePort.ts) and handing
// it to startNetgetMonad({ port }) — so both the guard and the monad
// itself are pinned to the SAME, already-decided value, rather than the
// guard learning the value from whatever the monad happened to pick.
//
// Swallowed rejections don't get you past this either: a violation is
// recorded in a module-local array regardless of whether the caller's
// catch (or a bare `.catch(() => {})`, common in these tests' own cleanup
// code) swallows the thrown error. A process.on('exit') handler installed
// at the same time forces process.exitCode = 1 and prints every violation
// if that array is non-empty when the process ends, so a caught-and-
// ignored violation still fails the process as a whole. uninstall()
// deliberately never removes that exit handler — restoring the original
// fetch must not also erase the evidence a violation happened.

export type MonadOriginGuardHandle = {
  violations: () => Array<{ url: string; at: string }>;
  uninstall: () => void;
};

function originOf(input: RequestInfo | URL): string {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;
  return new URL(rawUrl).origin;
}

function rawUrlOf(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;
}

/**
 * Installs the guard with its full allow-list already known. Every
 * fetch() from this point forward — including the very first one, e.g.
 * monad.ai's own startup health probe — is checked before it is sent.
 */
export function installMonadOriginGuard(allowedOrigins: string[]): MonadOriginGuardHandle {
  if (allowedOrigins.length === 0) {
    throw new Error('installMonadOriginGuard requires at least one allowed origin');
  }
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin));
  const violations: Array<{ url: string; at: string }> = [];
  const originalFetch = globalThis.fetch;

  const guardedFetch: typeof fetch = async (input, init) => {
    const actual = originOf(input);
    if (!allowed.has(actual)) {
      const url = rawUrlOf(input);
      const at = new Date().toISOString();
      violations.push({ url, at });
      const message = `[monad-origin-guard] BLOCKED a request to "${actual}" — not in the allowed set (${[...allowed].join(', ')}). URL: ${url}`;
      // eslint-disable-next-line no-console
      console.error(message);
      throw new Error(message);
    }
    return originalFetch(input as any, init);
  };
  globalThis.fetch = guardedFetch;

  const exitHandler = () => {
    if (violations.length > 0) {
      process.exitCode = 1;
      process.stderr.write(
        `\n[monad-origin-guard] FAILING: ${violations.length} request(s) targeted a non-allowed origin during this run, `
        + `even if the code that triggered them caught the error:\n`,
      );
      for (const v of violations) process.stderr.write(`  - ${v.at}  ${v.url}\n`);
    }
  };
  process.on('exit', exitHandler);

  return {
    violations: () => violations.slice(),
    uninstall() {
      globalThis.fetch = originalFetch;
    },
  };
}
