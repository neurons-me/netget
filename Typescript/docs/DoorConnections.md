# Door connections

**Status: built and tested (2026-10-12): the generator's blocks in a disposable OpenResty, and the real FullTrailer app + real server + a real monad in a browser, through both doors. Not activated on the real local nginx, not on the VM.**

A *door* is a domain record: a host (`fulltrailer.suis-macbook-air.local`) or the `/apps/<name>/` mount of an app. Its
main destination (`type`/`target`: `app:fulltrailer`, `127.0.0.1:5173`, a folder) answers everything the record does not
carve out. A **connection** carves out one path prefix and sends it to a service of the app that is not a monad:

```
fulltrailer.<root>            or   localhost/apps/fulltrailer/
  /             -> the monad (front end)            /            -> the monad
  /api/fuel     -> 127.0.0.1:4000                   /api/fuel    -> 127.0.0.1:4000   (path preserved)
  /api/upload   -> 127.0.0.1:4000                   /api/upload  -> 127.0.0.1:4000
  /uploads/*    -> 127.0.0.1:4000                   /uploads/*   -> 127.0.0.1:4000
  /api/v1/*     -> the monad (never carved out)     /api/v1/*    -> the monad
```

It is the third destination an app has, next to its compiled files and its monad. Registering a destination does not start
or supervise it: the app runs its own server; netget routes to the address the operator declared.

## Who declares

The operator, through netget. An app may say what it needs; it cannot publish it. Nothing reads an app's registration or
self-reported metadata to create a connection. The declaration is a field of the domain record (`connections`, a JSON
string in the store, parsed and checked on read), written by:

```
netget door-connections <domain>                                  # list
netget door-connections <domain> --add /api/fuel=127.0.0.1:4000 --add /uploads=127.0.0.1:4000
netget door-connections <domain> --remove /uploads
netget door-connections <domain> --clear
```

(`netget` here is the one of this branch; a global `netget` from an older checkout does not have the command.)
Writing regenerates `domain-map.json`; the gateway reads it per request, no reload.

From the panel (Domains, the cable icon of a door): the same list, one `/ruta = 127.0.0.1:puerto` per line. It travels on
`POST /update-domain` as `updatedFields: { connections: [...] }`, behind the same operator gate as the door's other
fields — no new location in the router. The list REPLACES the previous one (`[]` removes them all); a list with one bad
entry is refused as a whole, `400 { code: 'CONNECTION_REFUSED' }`, and nothing is written; the door's `type`/`target` and
every other field are untouched by a connections-only update. An anonymous `GET /domains` shows neither `connections` nor
`target` (allow-list, `domainsProjection.mjs`); the admin session's full record carries them.

## Rules

Checked when it is declared (`src/runtime/doorConnections.ts`) **and again when a request arrives**
(`lua/lib/door_connections.lua`): `domain-map.json` is a file, and a file is not an authority.

| Rule | Why |
|---|---|
| prefix is a path, no `.`/`..`, no `//`, no trailing `/`, `[A-Za-z0-9._~-/]` only, ≤128 | what nginx matches is the normalized URI |
| matches the path and its descendants (`/api/fuel`, `/api/fuel/1`), never `/api/fuelAnything` | boundary, not string prefix |
| longest prefix wins | |
| no prefix on, under or **above** a reserved path (`/api/v1`, `/claims`, `/me`, `/apps`, `/domains`, `/assets`, …) | `/api` would cover the monad's `/api/v1`; a connection never takes what the gateway or the monad answer |
| target is `127.0.0.1:<port>` (or `localhost`, normalized), 1024–65535 | **this delivery**: a network destination is part of the model, not accepted yet |
| target port is not the gateway's (80, 443, 3000) and not a registered monad's (port or endpoint) | a monad is reached by `app:<name>`, which forces its Host and carries its identity; by port it would skip both. Netget's backend behind an app's door would turn a public request into a loopback one |
| at most 16 per door, no duplicate prefix | |
| a list with any invalid entry is refused as a whole; a stored invalid list reads as none | never a partial list that silently changes which path goes where |

A connection that matches but is not allowed when the request arrives is answered `502 {"error":"connection_not_applied"}`.
It never falls through to the monad (which would answer an API call with a page).

## Who may use a connection

The service behind a connection is the app's own server, and FullTrailer's has **no authentication of its own**:
`/api/fuel` (the fleet's fuel data), `/api/upload` (writes a file to disk) and `/uploads/*` answer anyone who reaches them
(`cors()` open, no header read). What stops a stranger is the gateway. A connection is therefore served only to the peers
the **app's exposure policy** admits (the same one `/apps/<name>/` applies to the monad: `enabled`, `visibility`
loopback|lan|wan, `network.allowLoopback|allowLan|allowWan`), judged on the address that connected to nginx, never on a
forwarded header. An app with no policy is judged as loopback-only; a `guest`-trust app has no connections; a door that
points at a bare `host:port` (no app) is loopback-only. Refusals are JSON: 403 `connection_forbidden`, 404 (app disabled),
503 `app_not_available` (the app behind the door is not live).

Two consequences to keep in view:

* The local FullTrailer policy today is `visibility: loopback`. A browser on the same Mac that uses
  `https://fulltrailer.<machine>.local` connects from the machine's LAN address, not 127.0.0.1: it is a LAN peer, and its
  connection requests are refused (the front end still loads: that is the monad's). `http://localhost/apps/fulltrailer/`
  and `fulltrailer.localhost` are loopback. Admitting the LAN is the operator's change of the app's policy, not a flag here.
* **What the app declared about authorization is a requirement, not a hint** (the policy's `auth` block). The gateway
  cannot verify a session or a role on a connection yet (a proof for a multipart upload is not built), so it does not
  pretend to: an operation whose declared requirement it cannot check is **refused** (403 `authorization_required`),
  whatever the peer's address is. Loopback is where a request comes from, not who it is.
  * a read (GET/HEAD/OPTIONS) is refused when `requiredForRead` is true;
  * anything else (POST/PUT/PATCH/DELETE) is refused unless the app explicitly declared `requiredForDestructive: false`.
    No declaration = required (fail closed).
  So with FullTrailer's real policy (`requiredForDestructive: true`) reads (`/api/fuel`, `/uploads/*`) are served and
  **`/api/upload` is refused on both doors until sessions can be verified**. The photo upload does not work through a door
  for now; the app says why. Enforcing it (a signed proof per operation, scoped to the app) is the follow-up.

Credentials: the gateway's own (`Authorization`, `Cookie`, `X-Me-Proof`, internal token, identity/scope headers) are not
forwarded. FullTrailer's server reads none of them, so nothing it needs is lost. An app whose server wants its own
credentials would need an explicit, per-connection decision about which headers pass; none is built.

## What the app's server receives

A request leaves through its own named location (`@door_connection`), not the monad's:

* the path the client used, minus the `/apps/<name>` mount, with its query string; the client's `Host`;
* **not**: `Authorization`, `Cookie`, `X-Me-Proof`, `X-Monad-Internal-Token`, `X-NetGet-*`, `X-Netget-Scopes` (blanked, whatever
  the client sent);
* `X-Forwarded-For` / `X-Real-IP` = the real peer (replaced, not appended: a forged value is not passed on), so the service can
  tell a public request from a local one although nginx reaches it over loopback.

If the service is off or does not answer: `502 {"error":"connection_unavailable","prefix":...}` as JSON, whatever the client
accepts. The rest of the door (the front end, `/api/v1/*`) keeps answering.

## Where it applies

* the **host door** (`location /` -> `surface_proxy.lua`), for a declared route of type `server`/`proxy`;
* the **path door** (`location ~ ^/apps/<name>(/.*)?` -> `monad_proxy.lua`): the connections of the record whose target is
  `app:<name>`.

**Not applied** (known): an app in `dist` frontend mode (`/apps/<name>/` served straight from its folder by nginx; its
`try_files … /index.html` would answer an API path with the HTML). The generator does not carve connections out of those
blocks yet. FullTrailer is not in that mode.

## Tested

* `tests/door-connections.test.ts` — the declaration rules.
* `tests/door-connections-lua.test.ts` — the library, the exposure gate and the host door's decision (Lua harness).
* `tests/door-connections-openresty.test.ts` — the generator's blocks (or an installed-style conf: `DOOR_CONF_FILE`, and any
  `lua/` tree: `DOOR_LUA_ROOT`) in a real OpenResty, both doors, two upstreams that can be switched off, a real
  non-loopback peer: prefix boundaries, query and path preserved, a 3 MB upload, JSON for an API nobody serves (never the
  app's HTML), the server off, refused targets, credentials not forwarded, forged `X-Forwarded-For`, the exposure policy.
* `tests/domain-connections-store.test.ts` — the store and the projection, on a disposable monad.
* `tests/door-connections-panel.test.ts` — the panel's route (`/update-domain` with `connections`): declare, refuse as a
  whole, other fields untouched, projection to `domain-map.json`, removal, 404, nothing without the gate, public view.
* **The real app, 2026-10-12, with the configuration it would run with** (monad with its default 100 KB limit; FullTrailer's
  real exposure policy; the new gateway files): FullTrailer's built front end, its real `server/index.js` (lockfile
  dependencies), a real monad of the release, a disposable OpenResty with the generator's blocks, a browser, through
  `http://fulltrailer.localhost:<p>/` and `http://localhost:<p>/apps/fulltrailer/`. A new test identity registers and its
  catalog is seeded in parts with no 413 (zero 413 in the gateway's log); a refused part (injected) shows "tu identidad ya
  está registrada, no se pudo inicializar remolques (parte 2 de 3)" and **Reintentar inicialización** writes only what was
  missing (part 1, 2, the marker, dollies, operadores; nothing twice); after re-entering, Remolques shows 350 of 350 on both
  doors. Tractos asks `/api/fuel` of its own door (the real server answers 500 JSON, no Samsara token configured: nothing
  was invented). `POST /api/upload` and `DELETE /uploads/*` are 403 `authorization_required` on both doors and never reach
  the service; the app shows the gateway's message. Server killed: 502 JSON, the front end keeps answering.
  **Not proven: the integration with Samsara.**

## To activate (nothing of this was done)

`~/.get/local/door-connections/` holds three scripts. They install what **this** machine has plus this work, not the
branch's other files: the installed `monad_proxy.lua` is older than the branch's (no `door_entry` block), so it is
installed + the connection hook only (`patch`), and the conf is installed + the connection block before each
`@mesh_gateway_error`. Preconditions are hashes: if anything installed changed since `prepare.sh`, `activate.sh` refuses.

```
bash prepare.sh     # reads the live tree, writes staging/ and a manifest; checks Lua syntax and nginx -t on a sandbox copy
bash activate.sh    # backup (conf, 2 handlers, lib listing) -> install -> nginx -t on the installed tree; restores by itself if it fails
sudo openresty -t && sudo openresty -s reload            # yours: the master is root's
bash rollback.sh [backup-dir]   # conf + Lua restored byte for byte, lib file removed, verified; then reload again
```

Rehearsed on a copy of the real tree: activate then rollback is byte-identical (`diff -r` empty); drift after `prepare.sh` is
refused; an invalid staged conf is installed, fails `nginx -t` and is restored without help. The staged files pass the
OpenResty walk (`DOOR_LUA_ROOT`, `DOOR_CONF_FILE`).

`prepare.sh` also stages the **main `nginx.conf`** from this branch (the domain router's policy and header hygiene) and
requires the installed one to be exactly what the release writes for this machine (`nginx-main-conf/repair.sh` puts it
there); `activate.sh` installs it with the rest and `rollback.sh` restores it.

Then, with the netget of this branch (a global `netget` from an older checkout lacks the command):

1. register the door if it is not in the store (`fulltrailer.suis-macbook-air.local`, type `server`, target `app:fulltrailer`);
2. `door-connections <domain> --add /api/fuel=127.0.0.1:4000 --add /api/upload=127.0.0.1:4000 --add /uploads=127.0.0.1:4000`;
3. start FullTrailer's server: `npm ci` in `apps/FullTrailer/server` (lockfile exists), `PORT=4000`, and the Samsara token in
   `apps/FullTrailer/server/.env` (`SAMSARA_API_TOKEN=...`, gitignored; `.env.example` names it). The token is never read by
   anything here;
4. serve a FullTrailer build whose calls go through `serviceUrl()` (branch `feat/access-existing-identity`).

Rollback of step 2 alone (inert if the old Lua is back, because the old handlers ignore the field):
`door-connections <domain> --clear`.

## Known limits

* An app in `dist` frontend mode is not carved (see above).
* **Operations that require a session are blocked, not enforced** (above). Uploading a photo through a door is one of them.
* The monad's request limit (100 KB, `express.json()` default) is the monad's and is **not** raised by anything here. FullTrailer's
  catalog seed was changed to fit it (parts, resumable; see the app's `seedCatalog.ts`). Editing a large list as one signed
  write (remolques, ~68 KB value, ~136 KB signed) still exceeds it: the same limit, on the edit path. Separate decision
  (per-record writes, or the limit).
* The app's server is not started or supervised by anything; netget routes to the address that was declared.
* **A door needs a name nginx answers.** `http://fulltrailer.localhost/` (port 80 of the real gateway) matches no
  `server_name` of the installed conf (`suis-macbook-air.local`, `<handle>.suis-macbook-air.local`, `localhost 127.0.0.1`),
  so it falls to the default block and shows the gateway's welcome page. A `.localhost` door needs its own `server_name`, and
  the monad needs to accept that Host (`MONAD_SELF_TAGS`) or the door to name the namespace it serves. Not built.
