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
    
  const machineHostname = (() => { const h = os.hostname(); return h.endsWith('.local') ? h : `${h}.local`; })();

  // ─── Shared vendor assets (React UMD) — served by mesh, never reach the monad ──
  // Resolve paths relative to all.this root (6 levels up from this file's directory).
  const allThisRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../');
  const reactUmdDir = path.join(allThisRoot, 'packages/GUI/npm/node_modules/react/umd').replaceAll('\\', '/');
  const reactDomUmdDir = path.join(allThisRoot, 'packages/GUI/npm/node_modules/react-dom/umd').replaceAll('\\', '/');
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

  // ─── Namespace surface server block ────────────────────────────────────────
  // Routes <machine-hostname> → the monad whose namespace matches the host header.
  // The monad endpoint is resolved at request time from apps.json via Lua.
  const namespaceSurfaceBlock = `
# ─── Namespace Surface ────────────────────────────────────────────────────────
# ${machineHostname} → dynamic proxy to the monad registered for that namespace.
# surface_proxy.lua reads apps.json, matches host → monad endpoint.
server {
${listenLines}
    server_name ${machineHostname};
    client_max_body_size 500M;
${sslDirectives}
    set $NETGET_DATA_DIR ${xConfig};
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;
${vendorLocations}
    location / {
        set $surface_proxy_target "";
        rewrite_by_lua_file lua/handlers/surface_proxy.lua;
        proxy_pass $surface_proxy_target;
${proxyHeaders}
        proxy_set_header X-NetGet-Surface $host;
        proxy_set_header X-Forwarded-Host $host;
    }
}
`;

  return `
# netget_app.conf (generated)
# -----------------------------------------------------------
# Generated by setNginxConfigRoutes.ts - do not edit by hand in conf.d
# Two server blocks:
#   1. local.netget / localhost / 127.0.0.1 → Gateway admin UI + Lua API
#   2. ${machineHostname}                   → Namespace surface (proxy → monad)

lua_shared_dict jwt_cache 10m;

log_format netget_access '$remote_addr - - [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';
${namespaceSurfaceBlock}

server {
${listenLines}
    server_name local.netget localhost 127.0.0.1;
    client_max_body_size 500M;
${sslDirectives}

    set $NETGET_DATA_DIR ${xConfig};
    set $netget_logs_path ${layout.logDir};
    access_log ${layout.logDir}/netget_access.log netget_access;
    error_log  ${layout.logDir}/netget_error.log warn;

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

    # Auth
    location /check-auth {
        if ($request_method = OPTIONS) { return 204; }
        access_by_lua_file lua/middleware/jwt_cookie.lua;
        set $auth_action check_auth;
        content_by_lua_file lua/handlers/auth.lua;
        add_header 'Access-Control-Allow-Origin' $http_origin always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
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

}
`;
}
