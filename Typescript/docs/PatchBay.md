# Patch bay: mount an app, point a domain at it, change it, disconnect it

**Status: built and verified on a disposable gateway (2026-10-12), panel included. Not activated on the machine's gateway.**
The journey is `tests/patch-bay-journey.test.ts`; the panel's behaviour was driven in a browser against a disposable backend.

## Two routing planes (they do not have the same capabilities)

| | Plane A: `conf.d/netget_app.conf` | Plane B: the main `nginx.conf` default server |
|---|---|---|
| Serves | `<machine>.local`, `<handle>.<machine>.local`, `localhost`, `/apps/<name>/` | any other domain in `domain-map.json` |
| Decides with | `surface_proxy.lua` / `monad_proxy.lua` | an inline Lua router (`setNginxConfigFile.ts`) |
| `app:<name>` | by bare name, `monad:<name>`, `metadata.monadName`, live by TTL | (fixed 2026-10-12) same rules |
| Per-prefix connections (`door-connections`) | yes | **no** |
| Exposure policy / authorization of the app | yes | **no** |
| Errors | JSON (connections) / explanatory pages | explanatory pages (503 service, 404 not found) |
| Needs TLS | no | **yes**: the route must carry a certificate (see below) |

## What works (verified)

Static app: `type: static`, `target: <absolute folder>`. Service on a port: `type: server`, `target: 127.0.0.1:<port>`.
A registered monad: `type: server`, `target: app:<name>`.

1. `POST /add-domain` registers the door; `domain-map.json` is regenerated and the router picks it up within a second.
2. The domain opens (files, or the service, with the visitor's Host and `X-Forwarded-Proto`).
3. `POST /update-domain` changes `target` and/or `type` of the same record: service A -> service B, files A -> files B,
   service <-> files. Nothing is created or copied.
4. The service goes away: the visitor gets the gateway's 503 page, naming what the domain is pointed at; other domains are unaffected.
5. `POST /delete-domain` disconnects the door; the app's files and processes are not touched.
6. Authorization: an anonymous caller gets 401 `ADMIN_SESSION_REQUIRED`, a session without `gateway:write` gets 403
   `CAPABILITY_DENIED`, a session with it succeeds; listing `GET /domains` is public and trimmed.

## Supported destinations (declared; `src/runtime/routeTargets.ts` is the one definition)

| Kind | Route | Target | Protections |
|---|---|---|---|
| App registered with this gateway | `server` / `proxy` | `app:<name>` | the app's exposure policy and guest trust apply to the domain too; the app's own writes are authorized by the app |
| Service at a port | `server` | `host:port` (this machine or another one; `http://` is normalized away; a bare port means `127.0.0.1:<port>`) | refused: gateway ports (80, 443, 3000) on a loopback name, the port of a registered app (reach it by `app:`), link-local `169.254.x.x`, `https://` upstreams (not supported yet), a path or credentials in the target |
| Folder of files | `static` | absolute path (no `..`) | the panel says when it does not exist or has no `index.html` |
| The monad's surface | `proxy` | none | resolved by the monad |

The same rules are enforced by the store (every writer: the panel, `/add-domain`, `/update-domain`, `netget routing`) and
again when the map is projected for the router, so no entry is a way around another. What the router hands a service: the
real peer in `X-Forwarded-For` (replaced, not appended) and none of `X-NetGet-Identity`, `X-Netget-Scopes`, `X-NetGet-Internal`,
`X-Me-Proof`, `X-Monad-Internal-Token`.

## What the panel does now (`Domains.jsx`)

* **Conectar puerta**: domain + destination by kind (a registered app from the live registry, a service, a folder, the
  monad's surface). A refusal from the gateway is shown with its reason.
* **Cambiar destino**: the same record, a new destination ("no se crea otra identidad ni se copian datos").
* **Estado** per door, from `GET /domains/status` (admin): the destination answers / does not / is missing / unknown;
  applied to the router or not; TLS configured or pending. When the gateway cannot answer the panel says "estado
  desconocido" and lists the routes anyway.
* **Abrir**: enabled only when the door has a certificate; otherwise the tooltip says "TLS pendiente". The panel does not
  hide the failure behind a wrong certificate: without one the router cannot complete an HTTPS handshake at all.
* **Desconectar**: removes the record; the dialog says that files and the app are not touched, and the notice repeats it.

## What is missing

* **A certificate is still the operator's act.** The add form has no certificate fields; `provision-cert` needs public DNS
  and ACME, so locally a door is "TLS pendiente" unless a certificate is assigned through the API.
* **Port 80**: a registered domain is neither served nor redirected over plain HTTP; the default server answers with the
  gateway's own page whatever the host is.
* **Door connections (prefix -> service) on the domain router** and the **authorization the app declared for operations**
  (`requiredForDestructive`) are plane A only; plane B applies the app's exposure and trust, not per-operation rules.
  Unifying both planes behind one decision is not done.
* **A connections editor in the panel** (CLI only), and a **per-door "why it failed" history**.
* **Other gateways** (below).

## Seeing other gateways (netget.site, a Raspberry) from this panel: what exists and what does not

*Read* works today for what a gateway publishes: `https://netget.site/gateway-identity`, `/domains` (public projection:
domain, type, tlsConfigured), `/main-server-namespace` and `/healthcheck` answer anonymously with `Access-Control-Allow-Origin: *`,
so a local panel can show the public face of the VM or of a Raspberry running netget. `/apps` is local-only (403 from
elsewhere), which is right.

*Bridging* (a local door whose destination is an app on another gateway) is a different capability and is **not built**:

* the destination needs a kind of its own (`gateway:<id>` + the app there), declared by the operator in the signed claim
  record, never learned from a report;
* the path is only as trustworthy as the registration behind it: today's registry is loopback-only and heartbeats are not
  signed (CLAUDE.md gaps #1 and #2: surface identity unclaimed, trust ranking not verification), which the cross-host work
  is gated on;
* "while a path exists" is health: each hop's answer, from the same status model, with a time bound and a stated unknown;
* "patched by netget" means the operator's declaration decides the route, as it does for a local door.

## A finding about the installed gateway (2026-10-12)

`tests/nginx-conf-sync.test.ts` deleted and rewrote the machine's real `/opt/homebrew/etc/openresty/nginx.conf` with a temp
data dir. A real nginx error log shows the effect on 2026-10-08 and 2026-10-11, and it happened again during a regression
run on 2026-10-12: the main config then reads `domain-map.json`, the status-page templates and the html root from a temp
dir, so plane B cannot route anything on that machine. The test now uses a sandbox layout and asserts the installed file is
untouched; `~/.get/local/nginx-main-conf/repair.sh` renders the correct file for the machine (release templates, real data
dir), refuses if anything else differs, backs up, verifies with `nginx -t` and does not reload.
