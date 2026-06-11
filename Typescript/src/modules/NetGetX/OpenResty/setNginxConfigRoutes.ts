import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';
import { detectOpenRestyLayout } from './platformDetect.ts';
import {
  getActiveStaticRoot,
  resolveMainServerFrontendConfig,
} from './mainServerFrontend.ts';
import { MKCERT_CERT_PATH, MKCERT_KEY_PATH } from '../Domains/SSL/mkcert/mkcert.ts';
import { getDomainMapPath } from '../../../runtime/domainMap.ts';

/**
 * Generate the content for netget_app.conf (app routes) with concrete paths.
 * We resolve xConfig from getNetgetDataDir() and bake absolute paths where nginx needs them.
 *
 * SSL is conditional: if the cert files are not present on disk, the server block
 * only listens on port 80 so OpenResty starts cleanly even before certs are generated.
 * Once certs exist (self-signed or mkcert), refresh the config and port 443 activates.
 */
export function getNetgetAppConfContent(): string {
  const xConfig = getNetgetDataDir();
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

  const rootLocation = isDevFrontend
    ? `
    # Root SPA proxied to React/Vite dev server
    location / {
        if ($request_method = OPTIONS) { return 204; }
        proxy_pass ${devProxyTarget};
${proxyHeaders}
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
`
    : `
    # Root SPA served from selected Main Server UI dist
    location / {
        if ($request_method = OPTIONS) { return 204; }
        root ${distRoot};
        index index.html;
        try_files $uri $uri/ /index.html;
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
        content_by_lua_file lua/handlers/logs.lua;
        try_files $uri $uri/ /index.html;
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

    # Monad reverse proxy
    location ~ ^/monads/([^/]+)(/.*)?$ {
        if ($request_method = OPTIONS) { return 204; }
        set $monad_proxy_name $1;
        set $monad_proxy_tail $2;
        set $monad_proxy_target "";
        rewrite_by_lua_file lua/handlers/monad_proxy.lua;
        proxy_pass $monad_proxy_target;
${proxyHeaders}
        proxy_set_header X-NetGet-App-Kind monad;
        proxy_set_header X-NetGet-Monad $monad_proxy_name;
    }

    # Domains
    location /domains {
        if ($request_method = OPTIONS) { return 204; }
        set $domain_action list_domains;
        try_files $uri $uri/ /index.html;
        content_by_lua_file lua/handlers/domains.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
        
    location ~ ^/domains/([^/]+)/subdomains$ {
        if ($request_method = OPTIONS) { return 204; }
        set $parent_domain $1;
        set $domain_action list_subdomains;
        content_by_lua_file lua/handlers/domains.lua;
        try_files $uri $uri/ /index.html;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
    location /add-domain {
        if ($request_method = OPTIONS) { return 204; }
        set $domain_action add_domain;
        content_by_lua_file lua/handlers/domains.lua;
        try_files $uri $uri/ /index.html;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
    }
    location /update-domain {
        if ($request_method = OPTIONS) { return 204; }
        set $domain_action update_domain;
        content_by_lua_file lua/handlers/domains.lua;
        try_files $uri $uri/ /index.html;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 86400 always;
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
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        add_header Vary "Accept" always;
        add_header Cache-Control "no-store" always;
        proxy_set_header X-NetGet-Surface $host;
        proxy_set_header X-Forwarded-Host $host;
    }`;

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
  //      nrp_handle.lua validates the handle, proxies to local.netget
  //      (which serves the .me identity surface / Cleaker)

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
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;
${vendorLocations}
${namespaceAssetLocations}
    location / {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_proxy_target "";
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        add_header Vary "Accept" always;
        add_header Cache-Control "no-store" always;
        proxy_set_header X-NetGet-Surface $host;
        proxy_set_header X-Forwarded-Host $host;
    }
}
`;

  // Block 2: NRP handle surface  — {handle}.${machineHostnameLower}
  // The regex server_name captures the handle label into $nrp_handle.
  // nrp_handle.lua validates the handle and injects X-NRP-* headers.
  // All traffic is proxied to local.netget (which hosts the .me identity surface).
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
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;
${vendorLocations}
${namespaceAssetLocations}

    location / {
        if ($request_method = OPTIONS) { return 204; }
        set $surface_proxy_target "";
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        add_header Vary "Accept" always;
        add_header Cache-Control "no-store" always;
    }
}
`;

  return `
# netget_app.conf (generated)
# -----------------------------------------------------------
# Generated by setNginxConfigRoutes.ts - do not edit by hand in conf.d
# NRP namespace tree:
#   ${machineHostnameLower}              → monad root (surface_proxy.lua → registered monad)
#   {handle}.${machineHostnameLower}     → handle identity surface (nrp_handle.lua → local.netget)
#   ${machineHostnameLower.replace(/\.local$/, '')}.netget  → admin/control plane (LAN access)
#   local.netget / localhost / 127.0.0.1 → admin/control plane (loopback alias)

lua_shared_dict jwt_cache      10m;
lua_shared_dict gateway_nonces  1m;

log_format netget_access '$remote_addr - - [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';
${namespaceSurfaceBlock}
${nrpHandleBlock}
${publicDomainBlocks}

server {
${listenLines}
    server_name local.netget ${machineHostnameLower.replace(/\.local$/, '')}.netget localhost 127.0.0.1${extraServerNames ? ' ' + extraServerNames : ''};
    client_max_body_size 500M;
${sslDirectives}

    set $NETGET_DATA_DIR ${xConfig};
    set $netget_logs_path ${layout.logDir};
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;

${mainServerLocations}

}
`;
}
