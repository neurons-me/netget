/**
 * monadHttpClient.ts
 *
 * Minimal write/read client for a monad's semantic HTTP surface
 * (POST / and GET /<path>), scoped to exactly what domainStore.ts needs.
 *
 * This intentionally does NOT import `this.gui`'s `monadClient.ts`, even
 * though the wire contract is identical (ported from it) — netget sits
 * below the UI layer in this repo's layer model (CLAUDE.md: Kernel →
 * Identity → Runtime(monad.ai) → Gateway(netget) → UI(GUI)), so netget
 * must not depend on a React component library just to talk HTTP to a
 * monad it owns. Claim/open are not needed here — netget's own monad
 * writes are unauthenticated local writes to a namespace it controls.
 */

export interface MonadWriteResult {
  memoryHash: string | null;
  path: string;
  timestamp: number;
}

export interface MonadReadResult<TValue = unknown> {
  value: TValue;
  path: string;
}

export class MonadHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MonadHttpError';
    this.status = status;
  }
}

function normalizePath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export async function writeToMonad<TValue = unknown>(
  transportOrigin: string,
  semanticNamespace: string,
  expression: string,
  value: TValue,
  operator?: '-',
): Promise<MonadWriteResult> {
  const ns = String(semanticNamespace || '').trim();
  const expr = String(expression || '').trim();
  if (!ns) throw new MonadHttpError('semanticNamespace is required', 400);
  if (!expr) throw new MonadHttpError('expression is required', 400);

  const url = new URL('/', transportOrigin);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-forwarded-host': ns,
      host: ns,
    },
    // operator:'-' is the real tombstone marker the semantic memory layer
    // understands (modules/monad's memoryStore.ts buildSemanticBranchTreeForNamespace
    // deletes the path from any later branch read when it sees this) — not a
    // convention invented here. Confirmed by testing: the underlying `.me`
    // kernel's self:write throws on a null/undefined body regardless of
    // operator ("self:write requires a body payload"), so a delete call
    // must still carry a real (ignored-on-read) value — `value` here is
    // never null even for a delete; callers pass a placeholder.
    body: JSON.stringify(operator ? { operation: 'write', expression: expr, operator, value } : { operation: 'write', expression: expr, value }),
  });

  let payload: any;
  try {
    payload = await res.json();
  } catch (error) {
    throw new MonadHttpError('Monad returned a non-JSON response', res.status);
  }
  if (!res.ok || payload?.ok === false) {
    throw new MonadHttpError(String(payload?.error || `Write failed (${res.status})`), res.status);
  }

  return {
    memoryHash: payload?.memoryHash ?? null,
    path: String(payload?.path || expr),
    timestamp: Number(payload?.timestamp || Date.now()),
  };
}

export async function readFromMonad<TValue = unknown>(
  transportOrigin: string,
  semanticNamespace: string,
  path: string,
): Promise<MonadReadResult<TValue>> {
  const ns = String(semanticNamespace || '').trim();
  const normalizedPath = normalizePath(path);
  if (!ns) throw new MonadHttpError('semanticNamespace is required', 400);
  if (!normalizedPath) throw new MonadHttpError('path is required', 400);

  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const url = new URL(`/${encodedPath}`, transportOrigin);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-forwarded-host': ns,
      host: ns,
    },
  });

  if (res.status === 404) {
    return { value: undefined as unknown as TValue, path: normalizedPath };
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch (error) {
    throw new MonadHttpError('Monad returned a non-JSON response', res.status);
  }
  if (!res.ok || payload?.ok === false) {
    throw new MonadHttpError(String(payload?.error || `Read failed (${res.status})`), res.status);
  }

  return {
    value: (payload?.value ?? payload?.target?.value) as TValue,
    path: normalizedPath,
  };
}
