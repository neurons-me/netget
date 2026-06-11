# Custom Domains & Gateway Status Pages

This page documents how `netget` routes custom (public) domains, and the
"gateway status" pages shown to visitors when a domain isn't fully wired up
yet.

## Adding a custom domain

1. Point your domain's DNS **A record** at this gateway's public IP address
   (shown on the `GatewayStatus.html` page when relevant, or via
   `getPublicIP()` / the `/ip-info` endpoint).
2. Run:
   ```bash
   netget domain add your-domain.example
   ```
3. `netget` registers the domain in the local domain store, regenerates
   `runtime/domain-map.json`, and (where supported) requests a Let's Encrypt
   certificate for the domain.

## Gateway status pages

`src/htmls/GatewayStatus.html` is a single templated page with placeholders
(`{{STATE}}`, `{{HOST}}`, `{{PUBLIC_IP}}`, `{{MAIN_SERVER}}`, `{{TARGET}}`)
rendered by Lua via simple `gsub` string substitution
(`_G.render_gateway_status(state, host, target)` in `setNginxConfigFile.ts`,
defined in `init_worker_by_lua_block`). The template is read once per worker
at startup, mirroring how `domain-map.json` is loaded.

There are 4 states:

### State 1 — NOT_CONFIGURED

**Trigger:** in the `default_server` block (port 80, `server_name _`),
`xConfig.mainServerName` is empty/unset.

Normally this block serves the panel's static `dist/` for any host. When no
main domain has been configured yet, requests are instead shown a welcome
page with the gateway's public IP and instructions to run
`netget` → **Main Server** → **Set public domain**.

**Exception:** requests to `local.netget`, `localhost`, `127.0.0.1`, or any
`*.local` host always continue to show the real panel — this keeps the
CLI-driven setup flow (which talks to `local.netget`) working even before a
public domain is configured.

### State 2 — ACME_PENDING

**Trigger:** the request `Host` is present in `domain-map.json`
(`route` exists) but `route.ssl.enabled` is `false` — i.e. the domain is
registered but its Let's Encrypt certificate hasn't been issued yet.

For plain HTTP (port 80) requests to such a domain, the gateway shows a
"Setting up HTTPS for `{{HOST}}`…" page with a refresh hint and a reminder
to verify the domain's A record points at the gateway's public IP (required
for ACME HTTP-01 validation to succeed).

### State 3 — DOMAIN_NOT_FOUND

**Trigger:** the request `Host` is **not** in `domain-map.json`, and is not
`local.netget`, `*.local`, or an IP address.

Previously this returned a bare `404`. It now shows a page explaining that
`{{HOST}}` is not registered with this gateway, with instructions to:

- point an A record at `{{PUBLIC_IP}}`, or
- point a CNAME at `{{MAIN_SERVER}}`,

then run `netget domain add {{HOST}}`.

### State 4 — SERVICE_UNAVAILABLE

**Trigger:** the request `Host` **is** in `domain-map.json` with a valid
`target`, but the proxied backend returns `502`/`503`/`504` or refuses the
connection.

Implemented via `proxy_intercept_errors on;` plus
`error_page 502 503 504 = @gateway_service_unavailable;` on the `@server`
proxy location. The status page explains that `{{HOST}}` is registered but
the service at `{{TARGET}}` isn't responding, with a troubleshooting hint.

### State 5 — NO_LIVE_MONAD (NRP namespace surface)

**Trigger:** a request arrives at the `namespaceSurfaceBlock` (e.g.
`http://<hostname>.local`) and `surface_proxy.lua` finds no live monad
claiming that namespace's rootspace in `apps.json`.

This is the only state handled outside of `setNginxConfigFile.ts` /
`GatewayStatus.html` — it lives in `surface_proxy.lua`'s
`send_no_monad_page()`, since it is mesh/NRP-specific rather than a
gateway-level routing failure.

- **Non-browser clients** (no `text/html` in `Accept`): unchanged JSON
  response, e.g.
  ```json
  { "host": "suis-macbook-air.local", "rootspace": "suis-macbook-air.local",
    "hint": "...", "error": "no live monad for: suis-macbook-air.local" }
  ```
- **Browser clients** (`Accept: text/html`): `assets/namespace-surface/no-monad.html`
  is rendered via `_G.render_no_monad(host, rootspace, hint, error)`
  (defined alongside `render_gateway_status` in the shared
  `init_worker_by_lua_block`). The page loads the same `this.gui.umd.js` /
  `styles.css` bundle used by a live monad's `__surface` page (via
  `/ns-assets/`), giving NO_LIVE_MONAD the same visual identity, plus a
  banner showing host/rootspace/hint/error from `window.__NETGET_DATA__`.

## Notes on testability

The Lua control flow that selects between these states at request time is
not unit-testable from the TypeScript test suite (it only runs inside
OpenResty/nginx). `tests/gateway-status.test.ts` instead asserts that
`buildNginxConfigContent()` emits the expected directives and Lua markers
for each state (template loading, `render_gateway_status`, the
`MAIN_SERVER_NAME == ""` branch, the `route.ssl.enabled == false` branch,
the unregistered-host branch, and the `error_page 502 503 504` /
`@gateway_service_unavailable` location).
