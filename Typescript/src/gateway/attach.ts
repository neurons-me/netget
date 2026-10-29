// attach.ts -- what `netget attach` / `netget detach` need around the library.
//
// Listing a running app is the library's job (attachExisting() in src/netget.ts sends the same registration netget() does,
// beats on the same heartbeat and releases the same way). What is left here is small: which entry kinds an app may name,
// where the local netget answers, and finding the id of an app by its name for `detach`.
import { attachedAppId, validateAttachName } from '../netget.js';

export const APP_ENTRY_KINDS = ['dist', 'vite', 'server', 'static'] as const;
export type AppEntryKind = (typeof APP_ENTRY_KINDS)[number];

/** Where the local netget answers: NETGET_LOCAL, else the gateway's own admin host. */
export function localNetget(): string {
  return (process.env.NETGET_LOCAL || 'http://localhost').trim().replace(/\/+$/, '');
}

/** What an app says about itself besides its name and port. Empty fields are left out. */
export function attachMetadata(m: { title?: string; monad?: string; entry?: string }): Record<string, string> {
  if (m.entry !== undefined && !(APP_ENTRY_KINDS as readonly string[]).includes(m.entry)) {
    throw new Error(`entry is one of: ${APP_ENTRY_KINDS.join(', ')}.`);
  }
  const out: Record<string, string> = {};
  if (m.title) out.title = m.title;
  if (m.monad) out.monad = m.monad;
  if (m.entry) out.entry = m.entry;
  return out;
}

export interface DetachResult { ok: boolean; ids: string[]; status: number }

/**
 * Takes an app out of the registry now. It looks the entries up BY NAME (an app that registered through netget() is
 * listed under its lease id, one that attached under `app:<name>`), and releases only entries of kind app.
 */
export async function detachByName(name: string, mainServer = localNetget()): Promise<DetachResult> {
  const problem = validateAttachName(name);
  if (problem) throw new Error(problem);
  const list = await fetch(`${mainServer}/apps`, { headers: { accept: 'application/json' } });
  if (!list.ok) return { ok: false, ids: [], status: list.status };
  const body = (await list.json().catch(() => ({}))) as { apps?: Array<{ id?: string; name?: string; kind?: string }> };
  const ids = (body.apps || []).filter((a) => a.kind === 'app' && a.name === name && typeof a.id === 'string').map((a) => a.id as string);
  if (ids.length === 0 && !(body.apps || []).some((a) => a.id === attachedAppId(name))) return { ok: false, ids: [], status: 404 };
  let ok = true;
  for (const id of ids) {
    const res = await fetch(`${mainServer}/apps/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!res.ok) ok = false;
  }
  return { ok, ids, status: ok ? 200 : 502 };
}
