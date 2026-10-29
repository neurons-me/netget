# Apps and monads in the registry

The registry (`runtime/apps.json`, listed by `GET /apps`) holds two kinds of entry, and they are not the same thing.

| | monad | app |
|---|---|---|
| What it is | the runtime that belongs to a `.me`: identity, claims, the tree | what people open: a Vite dev server, a built dist behind a static server, any server |
| Who reports it | the monad itself (every 3 s) | the app itself through the library (`netget()` / `attachExisting()`), or `netget attach` on its behalf |
| Entry id | `monad:<uuid>` | the id the app sent: its lease id (`netget()`), or `app:<name>` (`attachExisting()`, `netget attach`) |
| Gate | must answer `/__surface` with a `monadId` | must answer HTTP on a loopback port |
| Trust | derived from the identity it declares | always `guest` (what an app is, not a verdict) |
| Can be stopped by netget | only what netget spawned itself, and only with a signed proof + the capability | never |

Two entries can share a name (and a port: a monad that also serves a dist). They stay two entries. An app cannot take a monad's
entry by choosing its id (`409 ID_TAKEN`).

A site that is only a folder of files (neurons.me) is **not an app**: it is a static *domain* (`type: static`, an absolute folder),
declared by the operator in the panel ("Conectar puerta" -> "Carpeta de archivos"); see `PatchBay.md`.

## Reporting an app

One registration, the one `netget()` already sent (`src/netget.ts`). Two ways in:

```ts
// the app asks netget for its port (leased) -- unchanged
const s = await netget({ name: 'my-app', port: 'auto', kind: 'app' });

// the app already has its port (FullTrailer on 4100, a Vite server): no lease, the name is used exactly as given
const s = await attachExisting({ name: 'polls.studio', port: 4200, metadata: { title: 'Polls.Studio', entry: 'dist' } });
```

```bash
netget attach fulltrailer --port 4100 --monad fulltrailer --entry dist --title FullTrailer
netget attach demo --port 5173 --entry vite
netget attach demo --port 5173 --once        # report once; the entry expires after its ttl (12 s)
netget detach demo                           # take it out now (looked up by NAME)
```

`attach` is `attachExisting()` kept alive by the command: it reports every 3 s until it is stopped; Ctrl-C / SIGTERM release the
entry. The local netget is `NETGET_LOCAL` (default `http://localhost`).

On the wire (`POST /apps/report`, loopback only), `kind` is `app`, `service` or `system` (all listed the same way; the category is
shown). What is kept, after being reduced to its known keys and sizes (everything else is dropped):

- `name` (lowercase letters, digits, `.`, `-`, `_`), `port`, `id`, `pid`, `hostname`, `cwd`, `tags` (<= 16), `status`, `health`, `ui`,
  `lifecycle` (claims, shown; no code path acts on them), `ttlMs` (3-60 s).
- `exposure`: only `enabled`, `visibility`, `network.allow*` and `auth.mode/requiredFor*/rolesAllowed`. This is the policy that
  doors and `app:<name>` domains apply (see below).
- `metadata`: `title`, `description`, `version`, `monad`, `entry`, and `frontendDistDir` (an absolute path of plain characters, no
  `..`; whether it is ever served is the operator's `app-frontend-mode`, not the app's).

A `directEndpoint`, `claimed_namespaces`, an identity hash, a `url` or a host in the report are dropped: an app's own word is not
evidence of who it is, and nothing an app sends makes it the monad of a host. An app that registers before it listens (`netget()`
leases first) is answered `422 PORT_NOT_ANSWERING` until it does; its heartbeat retries.

## What apps do and do not do in routing

- `app:<name>` (a declared route, or the app behind a door) resolves to the **app** entry when one is live under that name, and to the
  monad of that name otherwise. A route that worked before an app was reported keeps working.
- Selection by what monads declare (their namespace, aliases, hosts) and by the authorized root only reads **monad** entries.
- `/apps/<name>/...` (monad_proxy) only reaches monads.
- A door connection may point at an app's own server (its port is not refused); a monad's port still is.
- Who may use a door connection, or a domain that points at `app:<name>`: the policy **the app declared** (`enabled`, `visibility`,
  `network.allow*`), judged on the address that connected. An app that declared nothing is loopback-only. A monad of the same name
  does not lend its policy to the app (and vice versa); a guest *monad* still has no connections.
  Note the limit: that policy is the app's own word, reported from this machine. It can only be as strong as the loopback
  containment of `/apps/report` (CLAUDE.md, known gap 2); a process on this machine could declare `wan` for an app name.

Proven on a disposable OpenResty in `tests/gateway-app-kind.test.ts` (accept/refuse, restart-all, routing),
`tests/gateway-app-registration.test.ts` (the real `netget()` registration, sanitising, id collisions, door policy),
`tests/gateway-app-attach.test.ts` (`attachExisting`, the heartbeat, the CLI), `tests/door-connections-lua.test.ts` (the policy rules)
and `tests/patch-bay-journey.test.ts` (an app entry and a static single-page site as domains).
