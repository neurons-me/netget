# Apps and monads in the registry

The registry (`runtime/apps.json`, listed by `GET /apps`) holds two kinds of entry, and they are not the same thing.

| | monad | app |
|---|---|---|
| What it is | the runtime that belongs to a `.me`: identity, claims, the tree | what people open: a Vite dev server, a built dist behind a static server, any server |
| Who reports it | the monad itself (every 3 s) | the app, or `netget attach` on its behalf |
| Entry id | `monad:<uuid>` | `app:<name>` |
| Gate | must answer `/__surface` with a `monadId` | must answer HTTP on a loopback port |
| Trust | derived from the identity it declares | always `guest` |
| Can be stopped by netget | only what netget spawned itself, and only with a signed proof + the capability | never |

Two entries can share a name (and a port: a monad that also serves a dist). They stay two entries.

## Reporting an app

```bash
netget attach fulltrailer --port 4100 --monad fulltrailer --entry dist --title FullTrailer
netget attach demo --port 5173 --entry vite
netget attach demo --port 5173 --once        # report once; the entry expires after its ttl (12 s)
netget detach demo                           # take it out now
```

`attach` reports every 3 s until it is stopped; Ctrl-C releases the entry. Against another gateway: `NETGET_LOCAL=http://host`
(and `NETGET_LOCAL_HOST=localhost` when the gateway answers its admin block on that name).

On the wire (`POST /apps/report`, loopback only): `{ "kind": "app", "name": "<name>", "port": <n>, "metadata": { "title", "monad", "entry" } }`.
Only those fields are kept. A `directEndpoint`, `claimed_namespaces`, an identity hash or a host in the report are dropped: an
app's own word is not evidence of who it is, and nothing an app sends makes it the monad of a host.

## What apps do and do not do in routing

- `app:<name>` (a declared route, or the app behind a door) resolves to the **app** entry when one is live under that name, and to the
  monad of that name otherwise. A route that worked before an app was reported keeps working.
- Selection by what monads declare (their namespace, aliases, hosts) and by the authorized root only reads **monad** entries.
- `/apps/<name>/...` (monad_proxy) only reaches monads.
- A door connection may point at an app's own server (its port is not refused); a monad's port still is.

Proven in `tests/gateway-app-kind.test.ts` (what the gateway accepts and refuses, restart-all, routing) and
`tests/gateway-app-attach.test.ts` (what `attach` sends, the heartbeat, the CLI), on a disposable OpenResty.
