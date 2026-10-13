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
* The policy's `auth` block (`requiredForDestructive: true`, `mode: session`, `rolesAllowed: [admin]`) is **not enforced by
  the gateway** for connections. While visibility is loopback that is bounded; **before widening visibility the server must
  authenticate or the gateway must** (a signed-proof check per connection, not built).

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
* **The real app, 2026-10-12**: FullTrailer's built front end, FullTrailer's real `server/index.js` (dependencies from its
  lockfile, `npm ci --ignore-scripts`), a real monad of the release, a disposable OpenResty with the generator's blocks, a
  browser. Through `http://fulltrailer.localhost:<p>/` and `http://localhost:<p>/apps/fulltrailer/`: the app signs in with
  a test identity and registers it; Tractos asks `/api/fuel` of the door it was loaded from (the real server answers 500
  JSON "SAMSARA_API_TOKEN no configurado": no token was configured, nothing was invented); an operator photo is uploaded by
  the app's own code to `/api/upload` and served back from `/uploads/<file>` (the avatar loads); with the server killed,
  `/api/fuel` and `/api/upload` are 502 JSON and the front end keeps answering. **Not proven: the integration with Samsara.**

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
* A **new** identity registering on a monad of this release fails with 413: the seed catalog is a signed write bigger than
  `express.json()`'s 100 KB default (found again in this walk; lifted for the disposable monad only, with a preload). It is
  the monad's, not the door's, and it will hit the real FullTrailer when a new identity enters.
* The app's server is not started or supervised by anything; netget routes to the address that was declared.
