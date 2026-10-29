// attach.ts -- list a running APP in netget, as an app.
//
// An app is what people open: a Vite dev server, a built dist behind a static server, a plain server. It is not a
// monad, and it does not have to be one to be listed: it reports itself to the local netget as `kind: "app"` and keeps
// doing so (the entry expires after its ttl, like a monad's). The reporting side lives here so the CLI (`netget attach`)
// and anything that wants to report itself send the same thing; the accepting side is apps.lua's report_kind_app().
//
// What an app says about itself is small on purpose: a name, the port it answers on, a title, which monad it keeps its
// data in (by name), and what kind of entry it is. Netget keeps no more than that and gives it no authority.
import http from 'node:http';

export const APP_ENTRY_KINDS = ['dist', 'vite', 'server', 'static'] as const;
export type AppEntryKind = (typeof APP_ENTRY_KINDS)[number];

/** Same rule apps.lua applies: lowercase letters, digits, dots, dashes, underscores; at most 63. */
export function validateAppName(raw: string): string | null {
  const name = String(raw ?? '').trim().toLowerCase();
  if (!name) return 'An app name is required.';
  if (name.length > 63) return 'An app name is at most 63 characters.';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return 'An app name is lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.';
  return null;
}

export interface AppReport {
  name: string;
  port: number;
  title?: string;
  /** The monad the app keeps its data in, by name. A reference, not a claim: netget does not verify it. */
  monad?: string;
  entry?: AppEntryKind;
  ttlMs?: number;
}

/** The exact body sent to /apps/report. */
export function appReportBody(r: AppReport): Record<string, unknown> {
  const problem = validateAppName(r.name);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(r.port) || r.port < 1 || r.port > 65535) throw new Error('A port between 1 and 65535 is required.');
  if (r.entry !== undefined && !APP_ENTRY_KINDS.includes(r.entry)) throw new Error(`entry is one of: ${APP_ENTRY_KINDS.join(', ')}.`);
  const name = r.name.trim().toLowerCase();
  const metadata: Record<string, string> = {};
  if (r.title) metadata.title = r.title;
  if (r.monad) metadata.monad = r.monad;
  if (r.entry) metadata.entry = r.entry;
  return { id: `app:${name}`, name, kind: 'app', port: r.port, ...(r.ttlMs ? { ttlMs: r.ttlMs } : {}), metadata };
}

export interface GatewayTarget {
  /** Where the local netget answers (default: NETGET_LOCAL, else http://127.0.0.1). */
  base?: string;
  /** The Host header to send (the gateway's admin block answers to `localhost`); default: NETGET_LOCAL_HOST, else the base's own host. */
  hostHeader?: string;
}

function post(target: GatewayTarget, route: string, body: unknown): Promise<{ status: number; json: any }> {
  const base = new URL(target.base || process.env.NETGET_LOCAL || 'http://127.0.0.1');
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: base.hostname, port: base.port || 80, path: route, method: 'POST', timeout: 8000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'close', ...((target.hostHeader || process.env.NETGET_LOCAL_HOST) ? { host: (target.hostHeader || process.env.NETGET_LOCAL_HOST) as string } : {}) },
    }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
      res.on('end', () => { let json: any = {}; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode || 0, json }); });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('the local netget did not answer in time')));
    req.write(payload);
    req.end();
  });
}

export interface AttachResult { ok: boolean; status: number; id?: string; error?: string; message?: string }

/** One report. Never throws for an HTTP refusal: the refusal is the result. */
export async function reportApp(report: AppReport, target: GatewayTarget = {}): Promise<AttachResult> {
  const r = await post(target, '/apps/report', appReportBody(report));
  return { ok: r.status === 200 && r.json?.success === true, status: r.status, id: r.json?.id, error: r.json?.error, message: r.json?.message };
}

/** Takes the app out of the registry right away (otherwise its entry simply expires after the ttl). */
export async function releaseApp(name: string, target: GatewayTarget = {}): Promise<AttachResult> {
  const problem = validateAppName(name);
  if (problem) throw new Error(problem);
  const id = `app:${name.trim().toLowerCase()}`;
  const r = await post(target, '/apps/release', { id });
  return { ok: r.status === 200 && r.json?.success === true, status: r.status, id, error: r.json?.error, message: r.json?.message };
}

/**
 * Reports every `intervalMs` until `signal` aborts, then releases the entry. A failed beat does not stop the loop (the
 * gateway may be restarting; the next beat fixes it); `onBeat` sees every result so the caller can say so.
 */
export async function attachLoop(
  report: AppReport,
  opts: { target?: GatewayTarget; intervalMs?: number; signal?: AbortSignal; onBeat?: (r: AttachResult | Error) => void } = {},
): Promise<void> {
  const interval = opts.intervalMs ?? 3000;
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
  while (!opts.signal?.aborted) {
    try { opts.onBeat?.(await reportApp(report, opts.target)); } catch (error) { opts.onBeat?.(error as Error); }
    await sleep(interval);
  }
  try { await releaseApp(report.name, opts.target); } catch { /* the gateway is gone: the entry expires by itself */ }
}
