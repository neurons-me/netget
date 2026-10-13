# Door connections

**Status: built and tested on a disposable OpenResty (2026-10-12). Not activated on the real local nginx, not on the VM.**

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
* `tests/door-connections-lua.test.ts` — the library and the host door's decision (Lua harness).
* `tests/door-connections-openresty.test.ts` — the generator's own blocks in a real OpenResty, both doors, with two
  upstreams that can be switched off: prefix boundaries, query and path preserved, a 3 MB upload, JSON for an API nobody
  serves (never the app's HTML), the server off, refused targets (gateway, nginx, registered monads, non-loopback,
  hostnames, path in target, prefixes over the monad's paths), credentials not forwarded, forged `X-Forwarded-For`.
* `tests/domain-connections-store.test.ts` — the store and the projection, on a disposable monad.

## To activate (nothing of this was done)

1. Back up `netget_app.conf` and the installed `lua/handlers/{surface_proxy,monad_proxy}.lua`.
2. Install `lua/lib/door_connections.lua` and the two handlers; regenerate `netget_app.conf` from this branch (it adds
   `@door_connection` / `@door_connection_error` and two `set` lines to each server block that has
   `@mesh_gateway_error`); `openresty -t`; reload.
3. Register the door if it is not in the store (`fulltrailer.suis-macbook-air.local`, type `server`, target
   `app:fulltrailer`) and declare its connections.
4. Install the dependencies of `apps/FullTrailer/server` and start it (`PORT=4000`, `SAMSARA_API_TOKEN` in its environment;
   it is not running today and its `node_modules` is absent).
5. Serve a FullTrailer build whose `/api/*` calls go through `serviceUrl()` (branch `feat/access-existing-identity`).

Rollback: `door-connections <domain> --clear` (immediate, no reload), then the saved conf and handlers.
