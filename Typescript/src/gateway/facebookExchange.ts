// Server-only Facebook Login code exchange for the gateway.
// The public App ID is read from keys.namespace.meta.app.id on the
// namespace tree, then META_APP_ID. The App Secret comes only from
// META_APP_SECRET (step 5 will store it encrypted for the server key).
// The App Secret must never be logged, returned to the client, read from
// the tree, or bundled for the browser. Graph calls go only to graph.facebook.com.

import { getGatewayRootNamespace } from '../kernel/netgetMonadProcess.js';
import { readFromMonad } from '../kernel/monadHttpClient.js';

export const FACEBOOK_GRAPH = 'https://graph.facebook.com';
export const FACEBOOK_API_VERSION = 'v21.0';
export const META_APP_ID_ENV = 'META_APP_ID';
export const META_APP_SECRET_ENV = 'META_APP_SECRET';
export const META_APP_REDIRECT_URIS_ENV = 'META_APP_REDIRECT_URIS';
export const FACEBOOK_EXCHANGE_PATH = '/oauth/facebook/exchange';
export const FACEBOOK_APP_PATH = '/oauth/facebook/app';
export const FACEBOOK_JSON_LIMIT = '8kb';
export const FACEBOOK_JSON_LIMIT_BYTES = 8 * 1024;

export const NAMESPACE_META_APP_PATH = 'keys.namespace.meta.app';
export const NAMESPACE_META_APP_ID_PATH = 'keys.namespace.meta.app.id';

/** Exact origins allowed for the registered redirect and for CORS. No wildcards. */
export const FACEBOOK_REDIRECT_ORIGINS = ['https://cleaker.me', 'https://www.cleaker.me'] as const;
export const FACEBOOK_REDIRECT_PATHS = ['/oauth/callback', '/'] as const;

type FetchLike = (input: string, init?: { method?: string }) => Promise<Response>;

export function readMetaAppId(): string | null {
  const id = String(process.env.META_APP_ID || '').trim();
  return id || null;
}

export function hasMetaAppSecret(): boolean {
  return Boolean(String(process.env.META_APP_SECRET || '').trim());
}

function metaAppSecret(): string {
  return String(process.env.META_APP_SECRET || '').trim();
}

/** Public App ID only. The reader must not return or look up the secret. */
export type NamespaceMetaAppIdReader = () => Promise<string | null> | string | null;

const APP_ID_SHAPE = /^\d{1,32}$/;

/** Accept a tree leaf (string/number) or an object that has `id`. Never reads `secret`. */
export function publicAppIdFromTreeValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim();
    return APP_ID_SHAPE.test(id) ? id : null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in value) {
    const raw = (value as { id?: unknown }).id;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const id = String(raw).trim();
    return APP_ID_SHAPE.test(id) ? id : null;
  }
  return null;
}

/**
 * Reads the public App ID from the local monad the gateway already talks to
 * (getNetgetMonadOrigin + getGatewayRootNamespace + readFromMonad).
 * Does not start a monad if NETGET_MONAD_ORIGIN is unset: returns null and
 * the caller falls back to env. Never logs the value or the error.
 */
export async function readPublicMetaAppIdFromTree(opts?: {
  origin?: string;
  namespace?: string;
  read?: typeof readFromMonad;
}): Promise<string | null> {
  try {
    const origin = String(opts?.origin || process.env.NETGET_MONAD_ORIGIN || '').trim();
    if (!origin) return null;
    const namespace = String(opts?.namespace || getGatewayRootNamespace() || '').trim();
    if (!namespace) return null;
    const read = opts?.read ?? readFromMonad;
    const { value } = await read(origin, namespace, NAMESPACE_META_APP_ID_PATH);
    return publicAppIdFromTreeValue(value);
  } catch {
    return null;
  }
}

export async function resolvePublicMetaAppId(
  readAppIdFromTree?: NamespaceMetaAppIdReader,
): Promise<string | null> {
  if (readAppIdFromTree) {
    try {
      const appId = String((await readAppIdFromTree()) || '').trim();
      if (APP_ID_SHAPE.test(appId)) return appId;
    } catch {
      // Fall through to env. Never log the error: it may contain secrets.
    }
  }
  const fromEnv = readMetaAppId();
  return fromEnv && APP_ID_SHAPE.test(fromEnv) ? fromEnv : null;
}

/** App ID from the tree, else env. Secret from env only. Never logs secrets. */
export async function resolveMetaAppCredentials(
  readAppIdFromTree?: NamespaceMetaAppIdReader,
): Promise<{ appId: string; appSecret: string; appIdSource: 'tree' | 'env' } | null> {
  let appId: string | null = null;
  let appIdSource: 'tree' | 'env' = 'env';
  if (readAppIdFromTree) {
    try {
      const fromTree = String((await readAppIdFromTree()) || '').trim();
      if (APP_ID_SHAPE.test(fromTree)) {
        appId = fromTree;
        appIdSource = 'tree';
      }
    } catch {
      // Fall through to env. Never log the error.
    }
  }
  if (!appId) {
    const fromEnv = readMetaAppId();
    appId = fromEnv && APP_ID_SHAPE.test(fromEnv) ? fromEnv : null;
    appIdSource = 'env';
  }
  const appSecret = metaAppSecret();
  if (!appId || !appSecret) return null;
  return { appId, appSecret, appIdSource };
}

export async function publicFacebookAppPayload(readAppIdFromTree?: NamespaceMetaAppIdReader):
  Promise<{ ok: true; appId: string } | { ok: false; message: string; status: number }> {
  const appId = await resolvePublicMetaAppId(readAppIdFromTree);
  if (!appId) return { ok: false, message: 'Facebook connect is not available.', status: 503 };
  return { ok: true, appId };
}

function tokenError(data: { error?: unknown }, fallback: string) {
  const message = (data && data.error) || fallback;
  return { ok: false as const, message: String(message), status: 400 };
}

async function readTokenReply(res: Response): Promise<{ access_token?: string; expires_in?: number; error?: string }> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return {
      access_token: typeof data.access_token === 'string' ? data.access_token : undefined,
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || undefined,
      error: (typeof data.error_description === 'string' ? data.error_description : undefined)
        || (typeof (data.error as { message?: string } | undefined)?.message === 'string' ? (data.error as { message: string }).message : undefined)
        || (typeof data.error === 'string' ? data.error : undefined),
    };
  } catch {
    return { error: text || `HTTP ${res.status}` };
  }
}

export type ExchangeInput = {
  code: string;
  redirectUri: string;
  verifier: string;
  now?: number;
  fetch?: FetchLike;
  readAppIdFromTree?: NamespaceMetaAppIdReader;
};

export type ExchangeResult =
  | { ok: true; token: string; expires: string }
  | { ok: false; message: string; status: number };

export async function exchangeFacebookCodeWithEnv(opts: ExchangeInput): Promise<ExchangeResult> {
  const creds = await resolveMetaAppCredentials(opts.readAppIdFromTree);
  const clientId = creds?.appId ?? '';
  const clientSecret = creds?.appSecret ?? '';
  if (!clientId || !clientSecret) {
    return { ok: false, message: 'Facebook connect is not available.', status: 503 };
  }
  const code = String(opts.code || '').trim();
  const redirectUri = String(opts.redirectUri || '').trim();
  const verifier = String(opts.verifier || '').trim();
  if (!code || !redirectUri || !verifier) {
    return { ok: false, message: 'This sign-in expired or did not match. Try again.', status: 400 };
  }
  const run = opts.fetch ?? fetch;
  const tokenUrl = `${FACEBOOK_GRAPH}/${FACEBOOK_API_VERSION}/oauth/access_token`;

  const shortQ = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
    client_secret: clientSecret,
  });
  const shortRes = await run(`${tokenUrl}?${shortQ}`, { method: 'GET' });
  const short = await readTokenReply(shortRes);
  if (!short.access_token) return tokenError(short, 'Could not exchange the Facebook code.');

  const longQ = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: short.access_token,
  });
  const longRes = await run(`${tokenUrl}?${longQ}`, { method: 'GET' });
  const long = await readTokenReply(longRes);
  if (!long.access_token) return tokenError(long, 'Could not exchange for a long-lived token.');

  const now = opts.now ?? Date.now();
  const seconds = long.expires_in && Number.isFinite(long.expires_in) ? long.expires_in : 60 * 24 * 60 * 60;
  const end = new Date(now + seconds * 1000);
  const expires = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
  return { ok: true, token: long.access_token, expires };
}

const EXCHANGE_KEYS = new Set(['code', 'redirectUri', 'verifier']);

export function parseFacebookExchangeBody(body: unknown):
  { ok: true; code: string; redirectUri: string; verifier: string }
  | { ok: false; message: string; status: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'This sign-in expired or did not match. Try again.', status: 400 };
  }
  const rec = body as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!EXCHANGE_KEYS.has(key)) {
      return { ok: false, message: 'This sign-in expired or did not match. Try again.', status: 400 };
    }
  }
  const code = typeof rec.code === 'string' ? rec.code.trim() : '';
  const redirectUri = typeof rec.redirectUri === 'string' ? rec.redirectUri.trim() : '';
  const verifier = typeof rec.verifier === 'string' ? rec.verifier.trim() : '';
  if (!code || !redirectUri || !verifier) {
    return { ok: false, message: 'This sign-in expired or did not match. Try again.', status: 400 };
  }
  return { ok: true, code, redirectUri, verifier };
}

/** Normalize to origin + pathname. Rejects credentials, query, hash, and wildcards. */
export function normalizeFacebookRedirect(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text || text.includes('*')) return null;
  try {
    const u = new URL(text);
    if (u.username || u.password) return null;
    if (u.search || u.hash) return null;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const path = u.pathname === '' ? '/' : u.pathname;
    if (!FACEBOOK_REDIRECT_PATHS.includes(path as (typeof FACEBOOK_REDIRECT_PATHS)[number])) return null;
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

function isCleakerHttpsOrigin(origin: string): boolean {
  return (FACEBOOK_REDIRECT_ORIGINS as readonly string[]).includes(origin);
}

/** Built-in exact list, plus exact extra URIs from META_APP_REDIRECT_URIS that are also cleaker.me https. */
export function defaultFacebookRedirectAllowlist(env: NodeJS.Dict<string> = process.env): string[] {
  const allowed: string[] = [];
  for (const origin of FACEBOOK_REDIRECT_ORIGINS) {
    for (const path of FACEBOOK_REDIRECT_PATHS) {
      allowed.push(`${origin}${path === '/' ? '/' : path}`);
    }
  }
  const extra = String(env[META_APP_REDIRECT_URIS_ENV] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of extra) {
    const normalized = normalizeFacebookRedirect(item);
    if (!normalized) continue;
    try {
      const u = new URL(normalized);
      if (u.protocol === 'https:' && isCleakerHttpsOrigin(u.origin) && !allowed.includes(normalized)) {
        allowed.push(normalized);
      }
    } catch {
      // Ignore a bad extra entry. Never log it.
    }
  }
  return allowed;
}

export function isAllowedFacebookRedirect(redirectUri: string, allowlist?: string[]): boolean {
  const list = allowlist ?? defaultFacebookRedirectAllowlist();
  const normalized = normalizeFacebookRedirect(redirectUri);
  if (!normalized) return false;
  return list.includes(normalized);
}

/** Exact origin from the redirect allowlist, or null. Never returns '*'. */
export function facebookCorsAllowedOrigin(requestOrigin: string | undefined, allowlist?: string[]): string | null {
  if (!requestOrigin) return null;
  let origin: string;
  try {
    const u = new URL(requestOrigin);
    if (u.username || u.password) return null;
    origin = u.origin;
  } catch {
    return null;
  }
  const list = allowlist ?? defaultFacebookRedirectAllowlist();
  for (const item of list) {
    try {
      if (new URL(item).origin === origin) return origin;
    } catch {
      // skip
    }
  }
  return null;
}

/** Default tree-then-env reader used by the mounted routes. */
export function defaultPublicMetaAppIdReader(): NamespaceMetaAppIdReader {
  return () => readPublicMetaAppIdFromTree();
}
