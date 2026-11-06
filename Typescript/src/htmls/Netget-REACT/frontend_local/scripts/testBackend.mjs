// A stand-in for netget's backend (and its monad under /apps/netget), for scripts/check-gui-source.mjs.
//
// It answers what this app asks, with controlled responses, so the checks can reach Domains, Logs, a session and the
// permissions that depend on it without a real gateway. It verifies nothing a real backend would (signatures are not
// checked; who is signed in is whatever the scenario says), it persists nothing, and nothing it receives goes anywhere:
// a write is answered and recorded in `writes`, never applied. Everything it was asked is in `calls`; what it did not
// recognize is in `unknown`.
//
// Like nginx in front of the app, a page load (Accept: text/html) of a path the dev server proxies here is answered
// with the app itself, fetched from the dev server's own "/".
import http from 'node:http';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({ raw }); } });
});

// Who the gateway recognizes in the signed session (POST /check-auth), per scenario.
const RECOGNIZED = {
  none: { authenticated: false },
  owner: { authenticated: true, isOwner: true, isAdmin: true, scopes: ['gateway:control:logs-read'] },
  admin: { authenticated: true, isOwner: false, isAdmin: true, scopes: [] },
  stranger: { authenticated: true, isOwner: false, isAdmin: false, scopes: [] },
};

export const DOMAIN_ROW = { domain: 'example.test', target: 'http://127.0.0.1:4100', type: 'server', owner: 'ana' };
export const LOG_LINE = { timestamp: '2026-11-06T06:00:00Z', level: 'info', method: 'GET', path: '/marker-from-test-backend', status: 200, ip: '127.0.0.1', message: 'GET /marker-from-test-backend 200' };

export function startTestBackend({ port = 0, appOrigin } = {}) {
  const state = {
    scenario: 'none',
    calls: [],
    writes: [],
    unknown: [],
    origin: '',
    setScenario(name) {
      if (!RECOGNIZED[name]) throw new Error(`unknown scenario ${name}`);
      state.scenario = name;
    },
    reset() { state.calls.length = 0; state.writes.length = 0; state.unknown.length = 0; },
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://test');
    const p = u.pathname;
    const method = req.method;
    state.calls.push(`${method} ${p}`);
    const wantsPage = method === 'GET' && /text\/html/.test(req.headers.accept || '');

    if (wantsPage) {
      // nginx's try_files: the app answers for its own routes.
      const page = await fetch(`${appOrigin}/`).then((r) => r.text()).catch(() => '');
      res.writeHead(page ? 200 : 502, { 'content-type': 'text/html' });
      return res.end(page);
    }

    // ── the monad, through netget's /apps/<name> ─────────────────────────────────────────────────────────────────
    if (p.startsWith('/apps/netget')) {
      const rest = p.slice('/apps/netget'.length) || '/';
      if (rest === '/__surface') {
        const asked = u.searchParams.get('namespace') || 'localhost';
        return json(res, 200, {
          ok: true,
          monadId: 'monad-test',
          monad: { id: 'monad-test', name: 'netget' },
          resources: ['kernel:open', 'kernel:claim'],
          target: { namespace: { me: asked, host: '127.0.0.1' }, operation: 'read', path: '/' },
        });
      }
      if (rest === '/claims/signIn' && method === 'POST') {
        const body = await readBody(req);
        const ns = String(body.namespace || '');
        return json(res, 200, {
          ok: true, namespace: ns, identityHash: String(body.proof?.identityHash || `hash-${ns}`), memories: [], openedAt: Date.now(),
          target: { namespace: { me: ns, host: '127.0.0.1' }, operation: 'open', path: '/' },
        });
      }
      const kernel = rest.match(/^\/me\/kernel:(claim|open)\/(.+)$/);
      if (kernel && method === 'POST') {
        const ns = decodeURIComponent(kernel[2]);
        const target = { namespace: { me: ns, host: '127.0.0.1' }, operation: kernel[1], path: '/' };
        return json(res, 200, kernel[1] === 'claim'
          ? { ok: true, target, identityHash: `hash-${ns}`, createdAt: Date.now() }
          : { ok: true, target, identityHash: `hash-${ns}`, memories: [], openedAt: Date.now(), verified: true });
      }
      if (method === 'GET') return json(res, 404, { ok: false, error: 'NOT_FOUND' });   // reads of paths it does not hold
      state.writes.push(`${method} ${p}`);
      return json(res, 200, { ok: true });
    }

    // ── the gateway ──────────────────────────────────────────────────────────────────────────────────────────────
    // Signed (GET, with the session's proof); the proof is not checked: the scenario says who is recognized.
    if (p === '/check-auth') return json(res, 200, RECOGNIZED[state.scenario]);
    if (method === 'GET') {
      if (p === '/gateway-identity') return json(res, 200, { gatewayId: 'gw-test', bootstrapped: true, ownerUsername: 'ana' });
      if (p === '/healthcheck') return json(res, 200, { ok: true });
      if (p === '/main-server-namespace') return json(res, 404, { ok: false });   // none declared: the door names itself
      if (p === '/me/gateway') return json(res, 200, { hostname: 'test-gateway.local' });
      if (p === '/domains') return json(res, 200, { domains: [DOMAIN_ROW] });
      if (p === '/domains/status') return json(res, 200, { statuses: [] });
      if (p === '/apps') return json(res, 200, { apps: [] });
      if (p === '/logs') return json(res, 200, { logs: [LOG_LINE], total: 1, fileSize: 1, truncated: false, logType: u.searchParams.get('type') || 'access' });
      if (p === '/entrypoints') return json(res, 200, { entrypoints: [] });
      if (p === '/openresty-status') return json(res, 200, { installed: true, running: true });
      state.unknown.push(`${method} ${p}`);
      return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    }
    // Any other non-GET is a write: answered as accepted, recorded, never applied.
    state.writes.push(`${method} ${p}`);
    return json(res, 200, { ok: true, recordedOnly: true });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      state.origin = `http://127.0.0.1:${server.address().port}`;
      state.close = () => new Promise((r) => server.close(() => r()));
      resolve(state);
    });
  });
}
