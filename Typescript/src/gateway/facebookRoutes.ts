// HTTP routes for Facebook connect: GET /oauth/facebook/app and
// POST /oauth/facebook/exchange. Public (no admin session). The exchange
// is POST-only, JSON-limited, and accepts only code/redirectUri/verifier.
// Redirect URIs and CORS origins are an exact allowlist (cleaker.me, no *).
// The App Secret never appears in a response or a log.

import express, { type Request, type Response, type NextFunction } from 'express';
import {
  FACEBOOK_APP_PATH,
  FACEBOOK_EXCHANGE_PATH,
  FACEBOOK_JSON_LIMIT,
  defaultFacebookRedirectAllowlist,
  defaultPublicMetaAppIdReader,
  exchangeFacebookCodeWithEnv,
  facebookCorsAllowedOrigin,
  isAllowedFacebookRedirect,
  parseFacebookExchangeBody,
  publicFacebookAppPayload,
  type NamespaceMetaAppIdReader,
} from './facebookExchange.ts';

export type FacebookRouterOptions = {
  readAppIdFromTree?: NamespaceMetaAppIdReader;
  fetch?: (input: string, init?: { method?: string }) => Promise<Response>;
  now?: () => number;
  allowRedirects?: string[];
};

function applyCors(res: Response, origin: string | null): void {
  res.setHeader('Vary', 'Origin');
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '600');
}

function corsAndLimit(options: FacebookRouterOptions) {
  const allowlist = () => options.allowRedirects ?? defaultFacebookRedirectAllowlist();
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = facebookCorsAllowedOrigin(typeof req.headers.origin === 'string' ? req.headers.origin : undefined, allowlist());
    applyCors(res, origin);
    if (req.method === 'OPTIONS') {
      if (!req.headers.origin) return res.status(204).end();
      return res.status(origin ? 204 : 403).end();
    }
    if (req.headers.origin && !origin) {
      return res.status(403).json({ ok: false, message: 'Facebook connect is not available.' });
    }
    return next();
  };
}

function jsonErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (!err) return next();
  const status = Number((err as { status?: number; statusCode?: number }).status
    || (err as { statusCode?: number }).statusCode || 0);
  if (status === 413 || (err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ ok: false, message: 'This sign-in expired or did not match. Try again.' });
  }
  return res.status(400).json({ ok: false, message: 'This sign-in expired or did not match. Try again.' });
}

export function createFacebookRouter(options: FacebookRouterOptions = {}) {
  const router = express.Router();
  const readAppIdFromTree = options.readAppIdFromTree ?? defaultPublicMetaAppIdReader();
  const allowlist = () => options.allowRedirects ?? defaultFacebookRedirectAllowlist();

  router.use(FACEBOOK_APP_PATH, corsAndLimit(options));
  router.use(FACEBOOK_EXCHANGE_PATH, corsAndLimit(options));
  router.use(FACEBOOK_EXCHANGE_PATH, express.json({ limit: FACEBOOK_JSON_LIMIT, type: 'application/json' }));
  router.use(FACEBOOK_APP_PATH, express.json({ limit: FACEBOOK_JSON_LIMIT, type: 'application/json' }));

  router.get(FACEBOOK_APP_PATH, async (_req, res) => {
    const payload = await publicFacebookAppPayload(readAppIdFromTree);
    if (!payload.ok) return res.status(payload.status).json({ ok: false, message: payload.message });
    return res.status(200).json({ ok: true, appId: payload.appId });
  });
  router.all(FACEBOOK_APP_PATH, (_req, res) => {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Facebook connect is not available.' });
  });

  router.post(FACEBOOK_EXCHANGE_PATH, async (req, res) => {
    const parsed = parseFacebookExchangeBody(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ ok: false, message: parsed.message });
    if (!isAllowedFacebookRedirect(parsed.redirectUri, allowlist())) {
      return res.status(400).json({ ok: false, message: 'This sign-in expired or did not match. Try again.' });
    }
    const result = await exchangeFacebookCodeWithEnv({
      code: parsed.code,
      redirectUri: parsed.redirectUri,
      verifier: parsed.verifier,
      now: options.now ? options.now() : undefined,
      fetch: options.fetch,
      readAppIdFromTree,
    });
    if (!result.ok) return res.status(result.status).json({ ok: false, message: result.message });
    return res.status(200).json({ ok: true, token: result.token, expires: result.expires });
  });
  router.all(FACEBOOK_EXCHANGE_PATH, (_req, res) => {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'This sign-in expired or did not match. Try again.' });
  });

  router.use(FACEBOOK_APP_PATH, jsonErrorHandler);
  router.use(FACEBOOK_EXCHANGE_PATH, jsonErrorHandler);
  return router;
}

export default createFacebookRouter();
