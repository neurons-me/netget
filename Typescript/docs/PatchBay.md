# Patch bay: mount an app, point a domain at it, change it, disconnect it

**Status: audited and verified on a disposable gateway (2026-10-12). Not activated on the machine's gateway.**
The journey is `tests/patch-bay-journey.test.ts`.

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

## What is missing

For the journey, in the panel (`Domains.jsx`):

* **No way to change the destination.** The row's edit action is "Edit description". `POST /update-domain` exists and works.
* **No app picker.** The target is free text; a registered app has to be typed as `app:<name>`.
* **No state.** Nothing says whether a door's destination answers, which connection is applied, or opens it.
* **No certificate fields.** A route is served over TLS with ITS certificate (`sslCertificate`, `sslCertificateKey` of the
  record). The add form has none (certificates come from `provision-cert`, which needs public DNS and ACME).
* **No connections editor** (prefix -> service): CLI only (`netget door-connections`).

In the gateway:

* **A route with no certificate cannot complete a TLS handshake** on plane B (the router clears the default certificate and
  has none to put in its place), so the explanatory pages for "not found" and "pending certificate" are not reachable over
  HTTPS for such a host, and the visitor sees a TLS error. Over plain HTTP the default server answers with the gateway's
  own page whatever the host is: a registered domain is neither served nor redirected on port 80.
* Plane B does not apply door connections or the app's exposure policy (see above).
* **The two planes are separate code.** Making plane B decide with the same logic as plane A is the way to give every
  domain the same connections, authorization and errors; it is not done.

## A finding about the installed gateway (2026-10-12)

`tests/nginx-conf-sync.test.ts` deleted and rewrote the machine's real `/opt/homebrew/etc/openresty/nginx.conf` with a temp
data dir. A real nginx error log shows the effect on 2026-10-08 and 2026-10-11, and it happened again during a regression
run on 2026-10-12: the main config then reads `domain-map.json`, the status-page templates and the html root from a temp
dir, so plane B cannot route anything on that machine. The test now uses a sandbox layout and asserts the installed file is
untouched; `~/.get/local/nginx-main-conf/repair.sh` renders the correct file for the machine (release templates, real data
dir), refuses if anything else differs, backs up, verifies with `nginx -t` and does not reload.
