// The ports of the apps that are registered with this gateway (monads and others that report themselves). A door
// connection never targets one of them: a monad is reached by `app:<name>`, through the door's selection, which
// forces its Host and carries its identity; reaching it by port would skip both.
import { readReportedApps } from './appRegistry.js';

export function registeredMonadPorts(): number[] {
  const ports = new Set<number>();
  let apps: Array<Record<string, any>> = [];
  try { apps = readReportedApps() as Array<Record<string, any>>; } catch { return []; }
  for (const app of apps) {
    const port = Number(app?.port);
    if (Number.isInteger(port) && port > 0) ports.add(port);
    const meta = (app?.metadata ?? {}) as Record<string, unknown>;
    for (const key of ['endpoint', 'directEndpoint', 'controlEndpoint']) {
      const m = /:(\d+)\/?$/.exec(String(meta[key] ?? ''));
      if (m) ports.add(Number(m[1]));
    }
  }
  return [...ports];
}
