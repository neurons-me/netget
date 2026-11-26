// Server-only Facebook Login code exchange for the gateway.
// Credentials come from keys.namespace.meta.app when a server-readable
// (encrypted-for-server) tree entry is available; otherwise from
// META_APP_ID / META_APP_SECRET. The App Secret must never be logged,
// returned to the client, or bundled for the browser.
// Graph calls go only to graph.facebook.com.

export const FACEBOOK_GRAPH = 'https://graph.facebook.com';
export const FACEBOOK_API_VERSION = 'v21.0';
export const META_APP_ID_ENV = 'META_APP_ID';
export const META_APP_SECRET_ENV = 'META_APP_SECRET';
export const FACEBOOK_EXCHANGE_PATH = '/oauth/facebook/exchange';
export const FACEBOOK_APP_PATH = '/oauth/facebook/app';

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


/** Official path of the namespace Meta app in the tree. */
export const NAMESPACE_META_APP_PATH = 'keys.namespace.meta.app';

export type NamespaceMetaAppCredentials = {
  appId: string;
  appSecret: string;
};

/**
 * TODO: implement a reader that loads `keys.namespace.meta.app` from the
 * namespace tree and decrypts it with the server key. That needs the
 * hosting permission (encrypt-for-server-key) and kernel/monad work this
 * module does not include. Until that path exists, omit the reader and
 * the env vars META_APP_ID / META_APP_SECRET are the fallback.
 */
export type NamespaceMetaAppReader = () =>
  Promise<NamespaceMetaAppCredentials | null> | NamespaceMetaAppCredentials | null;

function envMetaAppCredentials(): NamespaceMetaAppCredentials | null {
  const appId = readMetaAppId();
  const appSecret = metaAppSecret();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/** Prefer a server-readable tree entry; otherwise the env fallback. Never logs secrets. */
export async function resolveMetaAppCredentials(
  readFromTree?: NamespaceMetaAppReader,
): Promise<{ appId: string; appSecret: string; source: 'tree' | 'env' } | null> {
  if (readFromTree) {
    try {
      const fromTree = await readFromTree();
      const appId = String(fromTree?.appId || '').trim();
      const appSecret = String(fromTree?.appSecret || '').trim();
      if (appId && appSecret) return { appId, appSecret, source: 'tree' };
    } catch {
      // Fall through to env. Never log the error: it may contain secrets.
    }
  }
  const fromEnv = envMetaAppCredentials();
  return fromEnv ? { ...fromEnv, source: 'env' } : null;
}

export async function resolvePublicMetaAppId(
  readFromTree?: NamespaceMetaAppReader,
): Promise<string | null> {
  if (readFromTree) {
    try {
      const fromTree = await readFromTree();
      const appId = String(fromTree?.appId || '').trim();
      if (appId) return appId;
    } catch {
      // Fall through to env. Never log the error.
    }
  }
  return readMetaAppId();
}

export async function publicFacebookAppPayload(readFromTree?: NamespaceMetaAppReader):
  Promise<{ ok: true; appId: string } | { ok: false; message: string; status: number }> {
  const appId = await resolvePublicMetaAppId(readFromTree);
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
  readFromTree?: NamespaceMetaAppReader;
};

export type ExchangeResult =
  | { ok: true; token: string; expires: string }
  | { ok: false; message: string; status: number };

export async function exchangeFacebookCodeWithEnv(opts: ExchangeInput): Promise<ExchangeResult> {
  const creds = await resolveMetaAppCredentials(opts.readFromTree);
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
