import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';
import { detectOpenRestyLayout } from './platformDetect.ts';
import {
  getActiveStaticRoot,
  resolveMainServerFrontendConfig,
} from './mainServerFrontend.ts';
import { MKCERT_CERT_PATH, MKCERT_KEY_PATH } from '../Domains/SSL/mkcert/mkcert.ts';
import { getDomainMapPath } from '../../../runtime/domainMap.ts';
import { readReportedApps } from '../../../runtime/appRegistry.ts';

/**
 * Generate the content for netget_app.conf (app routes) with concrete paths.
 * We resolve xConfig from getNetgetDataDir() and bake absolute paths where nginx needs them.
 *
 * SSL is conditional: if the cert files are not present on disk, the server block
 * only listens on port 80 so OpenResty starts cleanly even before certs are generated.
 * Once certs exist (self-signed or mkcert), refresh the config and port 443 activates.
 */
// OpenResty worker processes run under launchd with a stripped-down PATH (no
// nvm/homebrew bin dirs) and nginx clears inherited env vars entirely except
// what's explicitly declared via `env` directives (HOME is not declared) —
// so Lua handlers that shell out to the netget CLI (openresty.lua) can't
// reliably rediscover it at request time via `which`/PATH lookups. This
// Node process, running the actual netget CLI, still has a real PATH, so
// resolve the absolute bin path once here and bake it into the generated
// config as $NETGET_CLI_BIN — the same pattern already used for
// $NETGET_DATA_DIR.
function resolveNetgetCliBinPath(): string {
  try {
    const out = execFileSync('which', ['netget'], { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch { /* fall through — Lua handlers fall back to their own candidate scan */ }
  return '';
}

// Mirrors monad_proxy.lua's normalize_token()/app_monad_name() exactly — the
// public name an app answers to at /apps/<name> is metadata.monadName if
// set, else app.name with a "monad:" prefix stripped, both normalized the
// same way. Must stay byte-for-byte consistent with the Lua version or a
// generated location block's path won't match what monad_proxy.lua/apps.lua
// resolve at request time.
function normalizeAppToken(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function appPublicName(app: { name?: string; metadata?: Record<string, unknown> }): string {
  const direct = normalizeAppToken(app.metadata?.monadName);
  if (direct) return direct;
  return normalizeAppToken(String(app.name || '').replace(/^monad:/, ''));
}

// Generalizes netget's own dev↔dist Main Server panel switch
// (mainServerFrontend.ts) to any registered app. Emits one static-serve
// location per app currently in `dist` mode with a real, existing built
// dist — everything else keeps going through the live-proxy appMeshLocations
// regex untouched, so this is additive, not a replacement path. `alias`
// (not `root`) is required here since the matched prefix (/apps/<name>/)
// must be stripped before resolving the filesystem path — `root` would
// instead look under `<distDir>/apps/<name>/...`, which doesn't exist. The
// `^~` modifier makes nginx prefer this exact-prefix block over the shared
// `location ~ ^/apps/...` regex proxy even though regex normally wins over
// a plain (non-^~) prefix location — without it, every request would still
// fall through to monad_proxy.lua. Each block also carries its own
// exact-match `__frontend-mode` override: `^~` makes nginx skip regex
// evaluation entirely for anything under the matched prefix, which would
// otherwise swallow the one route needed to switch back out of dist mode
// (the generic regex route below still handles every app NOT currently in
// dist mode, including one that was never toggled at all).
function getAppFrontendDistLocations(): string {
  const apps = readReportedApps();
  const blocks: string[] = [];

  for (const app of apps) {
    const frontendMode = (app as { frontendMode?: string }).frontendMode;
    if (frontendMode !== 'dist') continue;

    const name = appPublicName(app);
    if (!name) continue;

    const distDir = String((app.metadata as Record<string, unknown> | undefined)?.frontendDistDir || '').trim();
    if (!distDir || !fs.existsSync(path.join(distDir, 'index.html'))) continue;

    const aliasRoot = distDir.endsWith('/') ? distDir : `${distDir}/`;

    blocks.push(`
    location ^~ /apps/${name}/ {
        if ($request_method = OPTIONS) { return 204; }
        alias ${aliasRoot};
        try_files $uri $uri/ /index.html;
        add_header 'Cache-Control' 'no-cache' always;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/${name}/__frontend-mode {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action frontend_mode;
        set $apps_target ${name};
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`);
  }

  return blocks.join('\n');
}

export function getNetgetAppConfContent(): string {
  const xConfig = getNetgetDataDir();
  const netgetCliBin = resolveNetgetCliBinPath();
  const layout = detectOpenRestyLayout();
  const frontend = resolveMainServerFrontendConfig();
  const isDevFrontend = frontend.mode === 'dev';
  // Ensure POSIX paths for nginx
  const activeStaticRoot = getActiveStaticRoot(frontend).replaceAll('\\', '/');
  const distRoot = path.posix.normalize(activeStaticRoot);
  const devProxyTarget = frontend.devUrl;

  // Certs live in ~/.netget/certs/ — user-owned, no sudo needed.
  // Only emit HTTPS directives when the cert file actually exists on disk.
  // Without this guard nginx refuses to start if ssl_certificate points to a missing file.
  const certsPresent = fs.existsSync(MKCERT_CERT_PATH) && fs.existsSync(MKCERT_KEY_PATH);
  const listenLines = certsPresent
    ? '    listen 80;\n    listen [::]:80;\n    listen 443 ssl;\n    listen [::]:443 ssl;'
    : '    listen 80;\n    listen [::]:80;';
  const sslDirectives = certsPresent
    ? `\n    ssl_certificate     ${MKCERT_CERT_PATH};\n    ssl_certificate_key ${MKCERT_KEY_PATH};\n`
    : '';

  const proxyHeaders = `
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;`;

  // Shared troubleshooting page for proxy_pass failures where the target was picked
  // from a live-looking registry entry but the connection itself failed — either
  // surface_proxy.lua's mesh reduction (apps.json) or monad_proxy.lua's /monads/:name
  // proxy, e.g. the target heartbeated recently but has since crashed. Without this,
  // nginx returns a bare, unbranded 502 straight from OpenResty. Reuses the exact same
  // _G.render_gateway_status(4, host, target) template (GatewayStatus.html "State 4:
  // SERVICE_UNAVAILABLE") that the main domain-map routing path already renders for the
  // same class of failure — see setNginxConfigFile.ts's @gateway_service_unavailable —
  // so both routing paths present one consistent troubleshooting page, not two.
  // _G.render_gateway_status is set once per worker in nginx.conf's
  // init_worker_by_lua_block and is available here because OpenResty shares one Lua VM
  // per worker across every included server block.
  const meshGatewayErrorLocation = `
    location @mesh_gateway_error {
        internal;
        default_type 'text/html; charset=utf-8';
        content_by_lua_block {
            local host = string.lower(ngx.var.host or ""):gsub(":%d+$", "")
            local target = ngx.var.surface_proxy_target
            if not target or target == "" then target = ngx.var.monad_proxy_target or "" end
            local body = _G.render_gateway_status and _G.render_gateway_status(4, host, target)
            if body then
                ngx.status = ngx.HTTP_SERVICE_UNAVAILABLE
                ngx.say(body)
            else
                ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
            end
        }
    }`;
  const meshProxyErrorHandling = `
        proxy_intercept_errors on;
        error_page 502 503 504 = @mesh_gateway_error;`;

  // /monads/:name and /apps/:name — the app-mesh reverse proxy, same
  // monad_proxy.lua handler for both (see the per-location comments below).
  // Shared across every server block that should be able to reach a
  // registered app by name — not just the local.netget/admin alias block,
  // but this machine's own hostname too (suis-macbook-air.local/apps/:name),
  // so an app is reachable through the host's real namespace, not only
  // through the loopback alias. Not wired into the NRP handle block
  // ({handle}.hostname) — that block addresses .me identities, and an app
  // is a virtual host/container, not an identity; conflating the two there
  // is exactly the confusion this route split is meant to avoid.
  const appMeshLocations = `
    # Monad reverse proxy — internal/infra route. Named by mechanism (which
    # monad answers this), not by product. Kept for debugging/tooling; the
    # public, user-facing route is /apps/:name below — both resolve through
    # the exact same monad_proxy.lua handler today (an app is just "a monad,
    # addressed publicly" for now), but /apps/:name is the one GUI/templates
    # and end users should ever see or type, since not every future app is
    # guaranteed to be a monad directly (a static surface, or netget's own
    # built-in admin UI, could just as well answer at /apps/<name>).
    location ~ ^/monads/([^/]+)(/.*)?$ {
        if ($request_method = OPTIONS) { return 204; }
        set $monad_proxy_name $1;
        set $monad_proxy_tail $2;
        set $monad_proxy_target "";
        rewrite_by_lua_file lua/handlers/monad_proxy.lua;
        proxy_pass $monad_proxy_target;
${proxyHeaders}
        proxy_set_header X-NetGet-App-Kind monad;
        proxy_set_header X-NetGet-Monad $monad_proxy_name;${meshProxyErrorHandling}
        # The monad's own Express app sets a blanket 'Access-Control-Allow-Origin: *'
        # (app.use(cors()) with no options) — nginx's add_header below does not
        # replace an upstream response header, only appends, so without hiding
        # it first the browser sees two Access-Control-Allow-Origin values and
        # rejects the response outright. The specific-origin echo below is the
        # one that's actually correct here anyway ('*' is invalid alongside
        # Access-Control-Allow-Credentials: true per the CORS spec).
        proxy_hide_header 'Access-Control-Allow-Origin';
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Forwarded-Host' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # App reverse proxy — the public, canonical route. Regex-matched, so it
    # never shadows the exact-match /apps/report, /apps/catalog/* routes
    # (only present in the admin-block copy of this same regex — those
    # exact-match routes still take priority over the regex per nginx's
    # matching order regardless of file order). Same handler as
    # /monads/:name today — nothing here assumes the target is a monad,
    # monad_proxy.lua just happens to be the only backing implementation
    # so far.
    location ~ ^/apps/([^/]+)(/.*)?$ {
        if ($request_method = OPTIONS) { return 204; }
        set $monad_proxy_name $1;
        set $monad_proxy_tail $2;
        set $monad_proxy_target "";
        rewrite_by_lua_file lua/handlers/monad_proxy.lua;
        proxy_pass $monad_proxy_target;
${proxyHeaders}
        proxy_set_header X-NetGet-App-Kind app;
        proxy_set_header X-NetGet-Monad $monad_proxy_name;${meshProxyErrorHandling}
        # The monad's own Express app sets a blanket 'Access-Control-Allow-Origin: *'
        # (app.use(cors()) with no options) — nginx's add_header below does not
        # replace an upstream response header, only appends, so without hiding
        # it first the browser sees two Access-Control-Allow-Origin values and
        # rejects the response outright. The specific-origin echo below is the
        # one that's actually correct here anyway ('*' is invalid alongside
        # Access-Control-Allow-Credentials: true per the CORS spec).
        proxy_hide_header 'Access-Control-Allow-Origin';
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Forwarded-Host' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`;

  // Per-app dev↔dist toggle route — generic, works immediately for any
  // registered app with zero per-app config, since netget_app.conf is only
  // ever regenerated on an explicit CLI action (frontend-mode, app-frontend-mode,
  // `netget init`), never automatically when an app registers. Placed BEFORE
  // appMeshLocations's /apps/:name proxy regex in the same server blocks —
  // nginx picks among competing regex locations by first match in file
  // order (not specificity), so this always wins for the __frontend-mode
  // path regardless of whether the app is currently proxied live or (once
  // getAppFrontendDistLocations() below adds its own more-specific
  // exact-match override for that case) served from a static dist.
  const appFrontendModeLocation = `
    location ~ ^/apps/([^/]+)/__frontend-mode$ {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action frontend_mode;
        set $apps_target $1;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`;
  const appFrontendDistLocations = getAppFrontendDistLocations();

  // The local.netget/127.0.0.1/localhost control-plane block proxies its own
  // panel to the Vite dev server (devProxyTarget). When that dev server isn't
  // running — e.g. after a reboot/sleep, before `npm run dev` has been
  // started again — nginx would otherwise return a bare, unbranded 502.
  // Reuses the same State 4 (SERVICE_UNAVAILABLE) GatewayStatus.html template
  // as @mesh_gateway_error / @gateway_service_unavailable, so every routing
  // path in netget shows one consistent, editable troubleshooting page
  // instead of raw OpenResty output. Only wired into rootLocation (the
  // document the browser actually navigates to) — the branded page is
  // self-contained (no external assets), so asset requests failing the same
  // way is a non-issue in that failure state.
  const netgetPanelErrorLocation = `
    location @netget_panel_unavailable {
        internal;
        default_type 'text/html; charset=utf-8';
        content_by_lua_block {
            local host = string.lower(ngx.var.host or ""):gsub(":%d+$", "")
            local body = _G.render_gateway_status and _G.render_gateway_status(4, host, "${devProxyTarget}", true)
            if body then
                ngx.status = ngx.HTTP_SERVICE_UNAVAILABLE
                ngx.say(body)
            else
                ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
            end
        }
    }`;
  const netgetPanelErrorHandling = `
        proxy_intercept_errors on;
        error_page 502 503 504 = @netget_panel_unavailable;`;

  // Declares the nginx var surface_proxy.lua fills with the winning candidate's
  // identity_hash (trust-tier-aware reduction — see surface_proxy.lua's
  // TRUST_RANK). Exposed as a response header so callers can observe which
  // monad identity actually answered, instead of that being silent.
  const meshIdentityVar = `set $surface_proxy_identity "";`;
  const meshIdentityHeader = `add_header X-NetGet-Identity $surface_proxy_identity always;`;

  const rootLocation = isDevFrontend
    ? `
    # Root SPA proxied to React/Vite dev server
    location / {
        if ($request_method = OPTIONS) { return 204; }
        proxy_pass ${devProxyTarget};
${proxyHeaders}
${netgetPanelErrorHandling}
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`
    : `
    # Root SPA served from selected Main Server UI dist. index.html is
    # deliberately never cached — it's the one file whose content decides
    # which hashed asset filenames get loaded next; a stale cached copy of
    # THIS specific file (not /assets/ below, already long-cached with
    # immutable + expires 365d) is what makes a browser show an old build
    # after a redeploy, silently, with no error to explain why.
    location / {
        if ($request_method = OPTIONS) { return 204; }
        root ${distRoot};
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header 'Cache-Control' 'no-cache' always;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`;

  const viteAssetLocation = isDevFrontend
    ? `
    # Vite dev/HMR and static files from dev server
    location ~* ^/(assets/|@vite|@react-refresh|src/|node_modules/|.*\\.(css|js|map|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$) {
        if ($request_method = OPTIONS) { return 204; }
        proxy_pass ${devProxyTarget};
${proxyHeaders}
        access_log off;
    }
`
    : `
    # Vite hashed assets
    location /assets/ {
        if ($request_method = OPTIONS) { return 204; }
        root ${distRoot};
        try_files $uri =404;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
        add_header 'Cache-Control' 'public, max-age=31536000, immutable';
        expires 365d;
    }

    # Serve static assets (CSS, JS, images)
    location ~* \\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        root ${distRoot};
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
        add_header Access-Control-Allow-Origin "*";
        add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob: http: https:;";
        access_log off;
    }
`;
    
  const machineHostname      = (() => { const h = os.hostname(); return h.endsWith('.local') ? h : `${h}.local`; })();
  const machineHostnameLower = machineHostname.toLowerCase();
  // Escape dots for PCRE regex in nginx server_name  (e.g. "suis-macbook-air\.local")
  const machineHostnameRegex = machineHostnameLower.replace(/\./g, '\\.');

  // Resolve public and local IPs from xConfig so nginx server_name covers all
  // Main Server entry points — hostname, local IP, and public IP serve the dashboard.
  const xConfigData = (() => {
    try {
      const p = path.join(xConfig, 'xConfig.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* ignore */ }
    return {};
  })();
  const publicIP = String(xConfigData.publicIP || '').trim();
  const localIP  = String(xConfigData.localIP  || '').trim();
  const mainServerName = String(xConfigData.mainServerName || '').trim().toLowerCase();

  // Extra server_name tokens for the Main Server dashboard block (IPs, if known).
  const extraServerNames = [localIP, publicIP]
    .filter(ip => ip && ip !== '127.0.0.1' && ip !== '::1')
    .join(' ');

  // ─── Shared vendor assets (React UMD) — served by mesh, never reach the monad ──
  // Resolve paths relative to all.this root (6 levels up from this file's directory).
  const allThisRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../');
  const reactUmdDir = path.join(allThisRoot, 'packages/GUI/npm/node_modules/react/umd').replaceAll('\\', '/');
  const reactDomUmdDir = path.join(allThisRoot, 'packages/GUI/npm/node_modules/react-dom/umd').replaceAll('\\', '/');
  const namespaceSurfaceRoot = path
    .join(allThisRoot, 'modules/netget/Typescript/assets/namespace-surface')
    .replaceAll('\\', '/');
  const namespaceSurfaceAssetsDir = path.join(namespaceSurfaceRoot, 'assets').replaceAll('\\', '/');
  const vendorLocations = fs.existsSync(reactUmdDir) ? `
    # Vendor assets — mesh intercepts, monad never sees these requests
    location /vendor/react/ {
        alias ${reactUmdDir}/;
        expires 1d;
        add_header Cache-Control "public, max-age=86400";
        add_header Access-Control-Allow-Origin "*";
        access_log off;
    }

    location /vendor/react-dom/ {
        alias ${reactDomUmdDir}/;
        expires 1d;
        add_header Cache-Control "public, max-age=86400";
        add_header Access-Control-Allow-Origin "*";
        access_log off;
    }
` : '';
  const namespaceAssetLocations = fs.existsSync(namespaceSurfaceAssetsDir) ? `
    # Namespace surface assets — served locally in development, never proxied to monad
    location /ns-assets/ {
        alias ${namespaceSurfaceAssetsDir}/;
        expires -1;
        add_header Cache-Control "no-store";
        add_header Access-Control-Allow-Origin "*";
        access_log off;
    }
` : '';

  const mainServerLocations = `
${rootLocation}
${isDevFrontend ? netgetPanelErrorLocation : ''}

    # Networks API
    location /networks {
        if ($request_method = OPTIONS) { return 204; }
        content_by_lua_file lua/handlers/networks.lua;
        try_files $uri $uri/ /index.html;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # Deploy API
    location /deploy {
        if ($request_method = OPTIONS) { return 204; }
        content_by_lua_file lua/handlers/deploy.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # Protected
    location /protected {
        if ($request_method = OPTIONS) { return 204; }
        access_by_lua_file lua/middleware/jwt_cookie.lua;
        content_by_lua_file lua/handlers/protected.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # Static assets (legacy path)
    location /media/ {
        if ($request_method = OPTIONS) { return 204; }
        root ${distRoot};
        try_files $uri $uri/ /index.html;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
        expires 30d;
    }

${viteAssetLocation}

    # Auth — stateless per-request Ed25519 (X-Me-Proof). No JWT, no cookie.
    # me_sig.lua verifies the proof and sets ngx.ctx.me_identity before auth.lua runs.
    location /check-auth {
        if ($request_method = OPTIONS) { return 204; }
        access_by_lua_file  lua/middleware/me_sig.lua;
        set $auth_action check_auth;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, X-Me-Proof' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location /logout {
        if ($request_method = OPTIONS) { return 204; }
        set $auth_action logout;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # .me challenge — GET → { nonce } (one-time 120s nonce for Ed25519 sign)
    location /me/challenge {
        if ($request_method = OPTIONS) { return 204; }
        set $auth_action challenge;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # .me identity auth — POST { proof } → JWT cookie (Ed25519 challenge-response)
    #                  or  POST { identityHash } → JWT cookie (legacy hash fallback)
    location /me/auth {
        if ($request_method = OPTIONS) { return 204; }
        set $auth_action me_auth;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # .me physical hostname — browser resolves namespace anchor from here
    location /me/gateway {
        if ($request_method = OPTIONS) { return 204; }
        set $auth_action gateway_info;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
    }

    # .me claim — POST { proof, username } → register identity on this gateway
    location /me/claim {
        if ($request_method = OPTIONS) { return 204; }
        content_by_lua_file lua/handlers/claim_identity.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, X-Me-Proof' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # .me claims list — GET → { claimed, owner, admins } with usernames
    location /me/claims {
        if ($request_method = OPTIONS) { return 204; }
        set $auth_action gateway_claims;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
    }

    # Logs
    location /logs {
        if ($request_method = OPTIONS) { return 204; }
        # Same /domains-vs-page collision (see that location's comment) —
        # /logs is also both a React Router page and a real API route.
        if ($http_sec_fetch_mode = "navigate") { rewrite ^ /index.html last; }
        content_by_lua_file lua/handlers/logs.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # .me kernel — gateway identity (loopback-only, no auth needed)
    location /gateway-identity {
        if ($request_method = OPTIONS) { return 204; }
        content_by_lua_file lua/handlers/gateway_identity.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
    }

    # OpenResty gateway control — status/restart/stop. status is read-only
    # (no sudo); restart/stop shell out through sudo (see openresty.lua).
    location = /openresty-status {
        if ($request_method = OPTIONS) { return 204; }
        set $NETGET_CLI_BIN "${netgetCliBin}";
        set $openresty_action status;
        content_by_lua_file lua/handlers/openresty.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /openresty-restart {
        if ($request_method = OPTIONS) { return 204; }
        set $NETGET_CLI_BIN "${netgetCliBin}";
        set $openresty_action restart;
        content_by_lua_file lua/handlers/openresty.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /openresty-stop {
        if ($request_method = OPTIONS) { return 204; }
        set $NETGET_CLI_BIN "${netgetCliBin}";
        set $openresty_action stop;
        content_by_lua_file lua/handlers/openresty.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # Local GUI dev server control — status/start/stop. status is read-only
    # (no sudo, safe to poll); start/stop just manage a plain child process
    # (no sudo needed, unlike openresty-restart/stop). Powers the "Start dev
    # server" button GatewayStatus.html shows for State 4 on this panel's
    # own domain when isDevFrontend and the dev server isn't responding.
    location = /dev-server-status {
        if ($request_method = OPTIONS) { return 204; }
        set $NETGET_CLI_BIN "${netgetCliBin}";
        set $dev_server_action status;
        content_by_lua_file lua/handlers/dev_server.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /dev-server-start {
        if ($request_method = OPTIONS) { return 204; }
        set $NETGET_CLI_BIN "${netgetCliBin}";
        set $dev_server_action start;
        content_by_lua_file lua/handlers/dev_server.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /dev-server-stop {
        if ($request_method = OPTIONS) { return 204; }
        set $NETGET_CLI_BIN "${netgetCliBin}";
        set $dev_server_action stop;
        content_by_lua_file lua/handlers/dev_server.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # Local app registry
    location = /apps {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action list;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/report {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action report;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/release {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action release;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/restart-all {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action restart_all;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    # Monad catalog — name → start-command registry
    location = /apps/catalog {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action catalog_list;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/catalog/upsert {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action catalog_upsert;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/catalog/delete {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action catalog_delete;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

    location = /apps/catalog/spawn {
        if ($request_method = OPTIONS) { return 204; }
        set $apps_action catalog_spawn;
        content_by_lua_file lua/handlers/apps.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }

${appFrontendModeLocation}
${appMeshLocations}
${appFrontendDistLocations}
${meshGatewayErrorLocation}

    # Which namespace this netget's own monad is designated as -- proxied to
    # Express (getGatewayRootNamespace() is a plain TS function, not Lua-
    # reachable), same forward-only pattern as /domains below.
    location = /main-server-namespace {
        # CORS headers ONLY on the OPTIONS branch, which nginx answers itself
        # (never reaches Express) -- the proxied GET response already carries
        # its own Access-Control-* headers from proxy.js's cors() middleware,
        # and add_header always appends on top of an upstream header of the
        # same name rather than replacing it. Duplicating them here produced
        # two Access-Control-Allow-Origin headers on every GET response,
        # which browsers treat as an invalid CORS response and reject
        # outright (confirmed live: curl saw a clean 200 with the value
        # doubled; a real fetch() failed with "Failed to fetch") -- the same
        # bug already latent on /domains and every other proxied location
        # below that repeats this pattern, not introduced here, just not
        # copied forward onto this new route.
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/main-server-namespace;
${proxyHeaders}
    }

    # Slice 2 — read-only network entrypoints / semantic surfaces report.
    # See src/types/SurfaceResolution.ts for the contract. No writes here;
    # /add-domain etc. below remain the only way to change what's registered.
    location = /entrypoints {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_resolution_action entrypoints;
        content_by_lua_file lua/handlers/surface_resolution.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
    }

    location = /surfaces {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_resolution_action surfaces;
        content_by_lua_file lua/handlers/surface_resolution.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
    }

    # Domains — kernel-backed (domainStore.ts) via the daemon, same pattern as
    # /domains/metadata below. Was content_by_lua_file into domains.lua
    # (SQLite, io.popen) until the Domain Store Split-Brain migration — see
    # docs/DomainStoreSplitBrain.md. No Lua business logic left here; verify
    # (loopback-only, enforced by nginx itself) and forward only. Response
    # shapes are unchanged from domains.lua's, so no frontend changes needed.
    location /domains {
        # /domains is both a React Router page (client-side navigation, no
        # server round-trip for the page itself) AND a real API route
        # (this app's own fetch('/domains') for row data). They collide on
        # a hard navigation — typing this URL directly, or refreshing — where
        # the browser's real HTTP request hits this location first and gets
        # raw JSON instead of the SPA shell. Sec-Fetch-Mode: navigate is set
        # by the browser only for real top-level navigations, never for a
        # fetch() call from the app's own JS, so it's a reliable signal to
        # fall through to the SPA instead of the API here — confirmed by
        # testing (this bug reproduced consistently on direct navigation).
        if ($http_sec_fetch_mode = "navigate") { rewrite ^ /index.html last; }
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above: add_header appends onto an upstream header of the same name
        # rather than replacing it, so putting these on the proxied GET/POST
        # branch double-sends Access-Control-Allow-Origin (proxy.js's cors()
        # middleware already sets it) and browsers reject the response.
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/domains;
${proxyHeaders}
    }

    location ~ ^/domains/([^/]+)/subdomains$ {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000;
${proxyHeaders}
    }
    location /add-domain {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/add-domain;
${proxyHeaders}
    }
    location /update-domain {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/update-domain;
${proxyHeaders}
    }
    location /delete-domain {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/delete-domain;
${proxyHeaders}
    }
    # Gateway capability model (Phase 1 prototype) — see
    # docs/GatewayCapabilityModel.md. me_sig.lua verifies the request's
    # Ed25519 proof (payload-bound: method+path+bodyHash+nonce+timestamp)
    # and sets ngx.ctx.me_identity/me_scopes; the block below bridges those
    # into nginx variables so proxy_set_header can forward them. The write
    # itself, and the capability check ("does me_scopes include
    # gateway:write:domain-metadata"), happen downstream in the daemon
    # (backend/routes/localNetget.js) — never decided here. Unlike every
    # other /domains* location above, this one has no Lua-side business
    # logic to duplicate; Lua's job stops at verify-and-forward.
    location = /domains/metadata {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, X-Me-Proof' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        set $me_identity "";
        set $me_scopes "[]";
        # access_by_lua_file and access_by_lua_block are the same directive
        # slot in nginx (can't declare both in one location), so this block
        # loads me_sig.lua itself instead. Must use loadfile()() here, NOT
        # dofile(): dofile() executes the chunk while still inside dofile's
        # own C call frame, and me_sig.lua's deny() path calls ngx.exit(),
        # which needs to yield — yielding across that C boundary aborts the
        # request with a reset connection ("attempt to yield across C-call
        # boundary", only ever hit when a proof is actually rejected here).
        # loadfile() only compiles and returns a function; calling that
        # function afterward is a plain Lua call with no C frame in between,
        # so ngx.exit() can yield normally — same verification behavior as
        # access_by_lua_file (used as-is by /check-auth), just invoked in a
        # way that also lets this block continue past it.
        access_by_lua_block {
            local me_sig_chunk = loadfile("${layout.luaDir}/middleware/me_sig.lua")
            me_sig_chunk()
            ngx.var.me_identity = ngx.ctx.me_identity or ""
            local cjson = require "cjson.safe"
            ngx.var.me_scopes = cjson.encode(ngx.ctx.me_scopes or {})
        }
        proxy_pass http://127.0.0.1:3000/domains/metadata;
${proxyHeaders}
        proxy_set_header X-Netget-Identity $me_identity;
        proxy_set_header X-Netget-Scopes $me_scopes;
    }

    # Issues a real Let's Encrypt cert for an already-registered domain via
    # netget provision-cert (netget.cli.ts -> certbotProvision.ts). Slow --
    # a real certbot round-trip, expect tens of seconds, not milliseconds.
    location /provision-cert {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/provision-cert;
${proxyHeaders}
    }

    # Semantic Inspector: Explain / Inspect — passthrough to netget's own
    # monad (see kernel/netgetMonadProcess.ts + localNetget.js's /explain,
    # /inspect routes). Same missing-location-block bug class already found
    # for /domains, /entrypoints, /surfaces earlier this session — these two
    # were added when the routes themselves were built but never wired into
    # the production gateway config, only Vite's dev proxy.
    location /explain {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/explain;
${proxyHeaders}
    }
    location /inspect {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/inspect;
${proxyHeaders}
    }

    # cleaker's TopologyResolver, implemented by netget (see
    # kernel/topologyResolver.ts) — "given a namespace, which live surface
    # currently claims it" — addressed here AND at local.cleaker (see the
    # admin server_name block below) so cleaker's resolver has its own name
    # distinct from local.netget's admin/control-plane surface.
    location /cleaker/resolve {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000/cleaker/resolve;
${proxyHeaders}
    }

    # <handle>.local.cleaker identity resolution — /@handle path form
    # (same convention useCleakerAuth.ts already uses against the machine's
    # own hostname, and monad's own resolveChainNamespace()/
    # getAtSelectorFromPath() already parse — reused here rather than
    # inventing a subdomain-based address, which /etc/hosts can't resolve
    # for arbitrary handles: no wildcard syntax exists there, only one
    # static entry per host is possible). The bare "location /" above is a
    # static try_files block (serves index.html straight from disk), so
    # this needs its own explicit regex location to ever reach Express —
    # same reasoning as /cleaker/resolve just above.
    location ~ ^/@ {
        # CORS headers ONLY on the OPTIONS branch — see /main-server-namespace
        # above for why (duplicate Access-Control-Allow-Origin on the proxied
        # response otherwise).
        if ($request_method = OPTIONS) {
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            return 204;
        }
        proxy_pass http://127.0.0.1:3000;
${proxyHeaders}
    }

    # Misc
    location /healthcheck {
        if ($request_method = OPTIONS) { return 204; }
        set $misc_action healthcheck;
        content_by_lua_file lua/handlers/misc.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
    location /ip-info {
        if ($request_method = OPTIONS) { return 204; }
        set $misc_action ip_info;
        content_by_lua_file lua/handlers/misc.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
    location /port-info {
        if ($request_method = OPTIONS) { return 204; }
        set $misc_action port_info;
        content_by_lua_file lua/handlers/misc.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
    location /test {
        if ($request_method = OPTIONS) { return 204; }
        access_by_lua_file lua/middleware/jwt_cookie.lua;
        set $misc_action test_endpoint;
        content_by_lua_file lua/handlers/misc.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`;

  // ─── Public domain server blocks (Let's Encrypt) ───────────────────────────
  // For each registered public domain that has a real Let's Encrypt cert on disk,
  // emit a dedicated server block on 443 with that cert. Without this, public
  // domains fall through to the first server block (mkcert/self-signed cert).
  const publicDomainBlocks = (() => {
    let domains: string[] = [];
    try {
      const mapPath = getDomainMapPath();
      if (fs.existsSync(mapPath)) {
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        domains = Object.keys(map.domains || {});
      }
    } catch { /* ignore */ }

    return domains.map(domain => {
      const letsencryptLiveRoot = process.env.NETGET_LETSENCRYPT_LIVE_DIR || '/etc/letsencrypt/live';
      const liveDir = path.join(letsencryptLiveRoot, domain);
      const certPath = path.join(liveDir, 'fullchain.pem');
      const keyPath = path.join(liveDir, 'privkey.pem');
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return '';
      const isMainServerDomain = !!mainServerName && domain.toLowerCase() === mainServerName;
      const domainLocations = isMainServerDomain
        ? mainServerLocations
        : `
${vendorLocations}
${namespaceAssetLocations}
    location / {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_proxy_target "";
        ${meshIdentityVar}
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        add_header Vary "Accept" always;
        add_header Cache-Control "no-store" always;
        ${meshIdentityHeader}
        proxy_set_header X-NetGet-Surface $host;
        proxy_set_header X-Forwarded-Host $host;${meshProxyErrorHandling}
    }
${meshGatewayErrorLocation}`;

      const domainDescription = isMainServerDomain
        ? 'Main Server dashboard with a public certificate.'
        : 'registered public domain with a public certificate.';

      return `
# ─── Public Domain (Let's Encrypt) ─────────────────────────────────────────────
# ${domain} → ${domainDescription}
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain};
    client_max_body_size 500M;
    ssl_certificate     ${certPath};
    ssl_certificate_key ${keyPath};

    set $NETGET_DATA_DIR ${xConfig};
    set $NETGET_CLI_BIN "${netgetCliBin}";
    set $netget_logs_path ${layout.logDir};
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;
${domainLocations}
}
`;
    }).join('');
  })();

  // ─── NRP server blocks ─────────────────────────────────────────────────────
  //
  // NRP namespace tree for this machine:
  //   ${machineHostnameLower}              ← the monad itself (machine substrate)
  //   {handle}.${machineHostnameLower}     ← human identity namespace on this monad
  //     me://handle.${machineHostnameLower}[selector]/path
  //
  // Two server blocks:
  //   1. Monad root  — ${machineHostnameLower} (bare)
  //      surface_proxy.lua → app whose namespace/hostname matches
  //   2. NRP handles — {handle}.${machineHostnameLower}
  //      surface_proxy.lua → registered monad; the monad resolves namespace
  //      semantics from the forwarded Host header.

  // Block 1: monad root (bare hostname)
  const namespaceSurfaceBlock = `
# ─── NRP Monad Root ───────────────────────────────────────────────────────────
# ${machineHostnameLower} = the monad itself.
# Everything goes to the monad — it decides HTML vs JSON from Accept header.
server {
${listenLines}
    server_name ${machineHostnameLower};
    client_max_body_size 500M;
${sslDirectives}
    set $NETGET_DATA_DIR ${xConfig};
    set $NETGET_CLI_BIN "${netgetCliBin}";
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;
${vendorLocations}
${namespaceAssetLocations}
${appFrontendModeLocation}
${appMeshLocations}
${appFrontendDistLocations}
    location / {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_proxy_target "";
        ${meshIdentityVar}
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        add_header Vary "Accept" always;
        add_header Cache-Control "no-store" always;
        ${meshIdentityHeader}
        proxy_set_header X-NetGet-Surface $host;
        proxy_set_header X-Forwarded-Host $host;${meshProxyErrorHandling}
    }
${meshGatewayErrorLocation}
}
`;

  // Block 2: NRP handle surface  — {handle}.${machineHostnameLower}
  // The regex server_name captures the handle label into $nrp_handle.
  // Current binding sends handle hosts through surface_proxy.lua. There is no
  // separate nrp_handle.lua handler in the shipped OpenResty handlers.
  const nrpHandleBlock = `
# ─── NRP Handle Surface ───────────────────────────────────────────────────────
# {handle}.${machineHostnameLower} → same monad, namespace resolved from Host header.
# The monad handles HTML vs JSON from Accept. No static SPA split.
server {
${listenLines}
    server_name ~^(?<nrp_handle>[^.]+)\\.${machineHostnameRegex}$;
    client_max_body_size 500M;
${sslDirectives}
    set $NETGET_DATA_DIR ${xConfig};
    set $NETGET_CLI_BIN "${netgetCliBin}";
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;
${vendorLocations}
${namespaceAssetLocations}

    location / {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_proxy_target "";
        ${meshIdentityVar}
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        add_header Vary "Accept" always;
        add_header Cache-Control "no-store" always;
        ${meshIdentityHeader}${meshProxyErrorHandling}
    }
${meshGatewayErrorLocation}
}
`;

  return `
# netget_app.conf (generated)
# -----------------------------------------------------------
# Generated by setNginxConfigRoutes.ts - do not edit by hand in conf.d
# NRP namespace tree:
#   ${machineHostnameLower}              → monad root (surface_proxy.lua → registered monad)
#   {handle}.${machineHostnameLower}     → handle namespace surface (surface_proxy.lua → registered monad)
#   ${machineHostnameLower.replace(/\.local$/, '')}.netget  → admin/control plane (LAN access)
#   local.netget / localhost / 127.0.0.1 → admin/control plane (loopback alias)
#   local.host                           → canonical local .me kernel surface, same admin block
#   local.cleaker                        → legacy alias for local.host (kept for compatibility)
#   local.host/@{handle}                 → identity-handle resolution — see localNetget.js's handle middleware
#   local.cleaker/@{handle}              → same, via the legacy alias

lua_shared_dict jwt_cache      10m;
lua_shared_dict gateway_nonces  1m;

log_format netget_access '$remote_addr - - [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';
${namespaceSurfaceBlock}
${nrpHandleBlock}
${publicDomainBlocks}

server {
${listenLines}
    server_name local.netget local.host local.cleaker ${machineHostnameLower.replace(/\.local$/, '')}.netget localhost 127.0.0.1${extraServerNames ? ' ' + extraServerNames : ''};
    client_max_body_size 500M;
${sslDirectives}

    set $NETGET_DATA_DIR ${xConfig};
    set $NETGET_CLI_BIN "${netgetCliBin}";
    set $netget_logs_path ${layout.logDir};
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;

${mainServerLocations}

}
`;
}
