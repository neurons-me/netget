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

## Gateway selector (the panel looks at one gateway at a time, and says which)

The Domains panel has a gateway bar: "Este netget" (the one that serves the panel) plus the gateways the operator adds by an
**explicit address** (`netget.site`, `raspberrypi.local:3000`, `http://192.168.1.40`). Nothing is discovered and nothing is
added by itself; the list lives in this browser (`localStorage`). The bar says which gateway is being viewed and, for it:

* **what can be queried**: its four public reads (`/gateway-identity`, `/healthcheck`, `/main-server-namespace`,
  `/domains`), each tried and classified (responds / refused / unreachable / not JSON). A browser cannot tell "nothing is
  there" from "CORS refused it"; the panel says so instead of choosing;
* **what may be modified**: asked of that gateway with the session stored FOR it, by `POST /add-domain {}` -- the capability
  gate answers before the handler looks at the body (401 not accepted, 403 valid but no `gateway:write`, 400 may: the empty
  request was refused, nothing written). Without a session the panel does not ask and says "solo lo que divulga";
* **whether its configuration is readable**: `/domains` with the session returning destinations. A gateway with no doors
  has nothing to check this against and is "Desconocido", not "Sí".

A session is stored under the gateway's own origin and only ever sent there. The existing endpoints and authorization are
reused as they are: no new route, no new scope. Writes (connect, change destination, disconnect) go to the selected
gateway with its session; the button is disabled while the gateway has not authorized writes. After a write the summary
asks again, and notices from one gateway are dropped when another is selected.

Walked in the Browser pane against a disposable second gateway B (CORS on, tokens `b-reader`, `b-admin`) and the real
`https://netget.site` without a session:

| gateway / session | reads | modify | observed |
| --- | --- | --- | --- |
| local, session | 4 respond | yes | empty request refused after authorization |
| B, none | 4 respond | no | "Conectar puerta" disabled |
| B, token of another gateway | 4 respond | no | 401 "no acepta esta sesión" |
| B, `b-reader` | 4 respond | no | 403 "solo lectura" |
| B, `b-admin` | 4 respond | yes | door connected from the panel exists on B and not on local; disconnected the same way |
| `netget.site`, none | 4 respond | no | identity, namespace `cleaker.me`, v2.56, 4 public doors; `/domains/status` is 404 there, so the panel lists the routes and says the state is unknown |

### With the real authorization, and with answers that arrive late (2026-10-13)

The table above used a test gate. The same walk was repeated against two disposable gateways that run the real gate
(`tests/gateway-admin-session-gate.test.ts`'s setup: a monad with the gateway module, an owner and a read-only admin that
sign in with a keychain key -> challenge -> session; CORS in front, an optional delay per request):

| session on that gateway | reads | its configuration | modify | observed |
| --- | --- | --- | --- | --- |
| none | 4 respond | No | No | "solo lo que divulga" |
| read-only admin | 4 respond | **Sí** (targets) | No | 403 "solo lectura"; "Conectar puerta" disabled; row states stay "desconocido" (`/domains/status` is gated) |
| the same admin after `gateway:write` is granted | 4 respond | Sí | **Sí** | same token, re-asked: the button enables |
| the same admin after the grant is taken back | 4 respond | Sí | No | 403 again, button disabled |
| owner | 4 respond | Sí | Sí | a door was connected from the panel; it shows "TLS pendiente / Responde" |

Answers that arrive late. Every asynchronous answer (probe, route list, states, apps, and a write already sent) is applied
only while the gateway AND session it was asked under are the ones on screen (`scopeKey`). Walked with a gateway that
answers in 4-5 s:

* **Before the guard** (control, the previous build): selecting the slow gateway and then "Este netget" before it answered
  left the slow gateway's route (`puerta-slow.test`) and a probe report under the "Este netget" header.
* **With the guard**: the same sequence left only "Este netget"'s own data for the 20 s observed.
* **An operation already sent keeps its destination**: "Desconectar" on the slow gateway, then switching to local before
  it answered: the door was removed on the slow gateway (checked there), the local table did not change, and the notice
  names the gateway ("... desconectado en Real lento."). An add cannot be switched away from: its dialog is modal.

Not walked: a session that changes while its requests are in flight (covered only by the scope key's unit test), and a key
revoked under a live session (covered by `gateway-admin-session-gate.test.ts`, not through the panel).

Limits: modifying `netget.site` from here was **not** done: it needs the VM's own admin session and an explicit go. The
panel's refresh reloads routes and states as well as the permission summary. The mesh (discovery, bridges between
gateways) is separate and not part of the selector.

## Authorization is applied where the write is executed (2026-10-13)

The panel shows what a session may do (reads, "Modificar puertas", a disabled "Conectar puerta"). That is only a
representation; the decision has to be taken by the process that executes the write.

**Finding.** The standalone backend (`src/htmls/Netget-REACT/backend/proxy.js`, what `netget backend-start` runs on
`:3000`) mounted the gateway's routers with no gate ("loopback only, nginx's job"). Anything that could reach
`127.0.0.1:3000` could add, change or delete a route: a panel run against it created a route on the machine's real store
with a bearer that was not a session. The gate (`gateway/adminGate.mjs`) existed only where the routes are mounted behind
a monad (`gateway/monadModule.mjs`, as on the VM).

**Now.** `proxy.js` mounts its routers through the same `mountGatewayRouters` (origin guard + gate), with the same
`resolveAdminSession` and `GatewayClaimsManager.isOwner`. Same three classes of route:

| class | routes | who |
| --- | --- | --- |
| public | the reads in `PUBLIC_ROUTES` (identity, namespace, `GET /domains` -> allow-listed view, health, ...) and, new, `POST /explain`, `POST /inspect` (forwarded to the monad's own public endpoints) | anyone |
| own | `/setup/*`, `/admin-session/*`, `/gateway-admin/*`, `GET /logs`, and, new, `/openresty/install*` (its own `requireAuth`) | what the route itself verifies |
| trusted | everything else: `add/update/delete-domain`, `provision-cert`, `domains/metadata`, `domains/status`, `openresty-restart|stop`, `frontend-mode`, `__gateway/claim`, `apps/report` | the machine's internal caller (token) or a verified admin session with `gateway:write` |

What it means for a client: no session -> 401 `ADMIN_SESSION_REQUIRED`; a session without `gateway:write` -> 403
`CAPABILITY_DENIED` naming `gateway:write`; identity headers (`x-netget-identity` / `x-netget-scopes`) are set from the
session and any the request carried are discarded. A read-only admin still reads the configuration (`GET /domains` with
its bearer). `gateway:write:domain-metadata` stays a second check inside `/domains/metadata`, on top of the gate.

**Not the same as before.** (1) The panel needs a stored session to enable writes (sign-in is the Logs page / the
challenge-verify flow); a bare `curl` to `:3000` no longer writes. (2) The identity headers that nginx's Lua perimeter set
for a signed proof are honored only from an internal caller, as on the VM. (3) The monad-only parts are unchanged.

**Tests.** `tests/standalone-backend-gate.test.ts` starts that entry point itself (a child process,
`tests/helpers/standaloneBackend.ts`) on a temp data dir, with a monad of its own and a marker namespace, and refuses to
send any write until `GET /main-server-namespace` has answered this run's marker. It checks anonymous refusal (with
forged headers and a bogus bearer), the public reads, a read-only admin, an owner's connect -> change destination ->
disconnect (and a destination the validation refuses), a grant read fresh on every call and taken back, the second
capability, and that none of the machine's own gateway files was written. Run against the previous `proxy.js` it fails at
the first anonymous add (200 instead of 401). `gateway-capability-model.test.ts` is a LIVE test of the real gateway and is
now opt-in (`NETGET_LIVE_GATEWAY_TEST=1`).

The panel was walked against that entry (disposable data, a marker proven through the dev proxy before the first write):
no session (summary "No", button disabled), a read-only session (reads the configuration, 403 on a hand-sent delete, the
route survived), the owner (connect -> change destination -> disconnect from the panel, states and notices as shown).

## What each piece changes when it is activated on this machine

Four things were being treated as one package; they are not, and none of them is activated yet:

0. **The backend of this branch** (`proxy.js` + routes) -- runs only when the real backend is restarted from a release that
   carries it (see `CHANGES-r20261013-1.md`). It is what applies the gate (section above), and the panel's "Conectar" is
   only as honest as the backend it talks to. The selector below must not go in front of the backend that is running
   now: against it the controls would be drawn without anything enforcing them.
1. **The selector (panel)** -- a static front-end build. Changes: the files nginx serves as the netget page
   (add-only hashed assets + `index.html`, with a backup and a rollback). No nginx reload, no Lua, no conf, no store.
   Against today's running backend (the older checkout) the selector and the reads work; "Cambiar destino" and the
   per-door state need the backend routes of this branch (`/domains/status`, `/update-domain`), which are 404 there and
   show as "desconocido" / an error, not as invented state.
2. **The main `nginx.conf` repair** -- already written to the file (backup in `~/.get/backups/nginx-main-conf-*`): only
   the data-dir and template paths that a test had replaced. The running master still holds what it loaded; it takes
   effect on the next reload (see "The configuration nginx has LOADED"). It is independent of 1 and 3.
3. **Door connections** -- `conf.d/netget_app.conf`, two Lua handlers and one library, plus the main conf, with
   `prepare.sh` / `activate.sh` / `rollback.sh` (rehearsed byte-identical). Needs a reload. Only this one changes how
   requests are routed.

The backend (0) is the one that must come first; none of the four activates another.

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

## The configuration nginx has LOADED (checked 2026-10-13)

The master's pid and start time do not say what it runs: a reload keeps the master and replaces the workers. What does:
the live worker (started 2026-10-11 21:32:16, after the last reload) was still opening
`/var/folders/.../netget-nginxsync-data-GpPdmz/html/NetgetErrorCodeHandler.html` on 2026-10-13 15:09 -- a temp dir of a
test that had rewritten `nginx.conf` on 2026-10-11. So the LOADED configuration is the polluted one of 2026-10-11, not the
file repaired on 2026-10-12 22:23 (which has `~/.get/html`). Until `sudo openresty -t && sudo openresty -s reload`, the
loaded `MAP_PATH`/templates/html root point at a directory that no longer exists. To check it again without reading
memory: the worker's start time against the file's mtime, and which data directory the worker's own error lines name.

## A finding about the installed gateway (2026-10-12)

`tests/nginx-conf-sync.test.ts` deleted and rewrote the machine's real `/opt/homebrew/etc/openresty/nginx.conf` with a temp
data dir. A real nginx error log shows the effect on 2026-10-08 and 2026-10-11, and it happened again during a regression
run on 2026-10-12: the main config then reads `domain-map.json`, the status-page templates and the html root from a temp
dir, so plane B cannot route anything on that machine. The test now uses a sandbox layout and asserts the installed file is
untouched; `~/.get/local/nginx-main-conf/repair.sh` renders the correct file for the machine (release templates, real data
dir), refuses if anything else differs, backs up, verifies with `nginx -t` and does not reload.
