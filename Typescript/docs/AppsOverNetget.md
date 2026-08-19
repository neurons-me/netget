# Apps Over Netget

Proof-of-concept doc. Written the day the circuit first worked end-to-end
(2026-08-18/19), so it doesn't decay into oral session knowledge.

**See also** — this spans three packages; each has its own piece of the
contract, cross-linked from here rather than duplicated:

- [NRP v0.3.0 §9](https://neurons-me.github.io/monad/Typescript/typedocs/NRP-v0.3.0.html#9-gateway-binding-notes) —
  where `/apps/:name`/`/monads/:name` sit in the gateway binding.
- [NRP v0.3.0 §11](https://neurons-me.github.io/monad/Typescript/typedocs/NRP-v0.3.0.html#11-websocket-binding-nrp) —
  the full `/nrp` WebSocket message contract (`nrp.open`, `read`,
  `subscribe`, `data`, `stream`, …) that the "live-semantic loop" section
  below only summarizes.
- [Mesh/status.md](https://neurons-me.github.io/monad/Typescript/typedocs/Mesh/status.html#current-websocket-surface) —
  current implementation status and known gaps for the monad side.
- [this.gui Runtime-Contract §1](https://github.com/neurons-me/GUI/blob/main/Typescript/Runtime-Contract.md#me-runtime-live-over-a-network-monad) —
  the client-side `createWsMeRuntime()` contract (not part of a built docs
  site — GUI's typedocs doesn't include this file yet).

---

## What this is a proof of concept of

Not "an app can reach a URL through netget" — that part already worked.
What's new: a normal `this.gui` React app can have **live, cross-client
`.me` state** — reads and writes over HTTP, invalidation over WebSocket —
addressed through netget's existing mesh by **name**, not by giving the app
its own subdomain, using infrastructure that already existed but had never
been exercised end-to-end (the WS-upgrade proxy headers, the `/monads/:name`
path proxy, the `/nrp` WebSocket handler's resolution handshake). This closes
the gap between "the pieces exist" and "the pieces actually work together,"
verified with three independent clients (a `curl` write from outside the
browser, and two open browser tabs) landing on the same live state with zero
manual refresh:

```
curl (external write)
  → netget: local.netget/apps/fulltrailer
  → monad: POST / (rootCommandHandler)
  → .me kernel write + pathNotify.notify()
  → /nrp WebSocket: 'stream' push
  → this.gui: createWsMeRuntime()'s subscribe callback
  → useSyncExternalStore
  → two independent React tabs re-render, in sync, unprompted
```

**This is a first working circuit, not a finished platform.** See "Known
gaps" below before building a second app on this pattern.

---

## Why `/apps/:name`, not a subdomain

The first instinct was to give each app its own DNS-shaped identity —
`fulltrailer.<machine-hostname>` — matching how personal namespaces already
work (`jabellae.<machine-hostname>`). Two problems, found by actually
building it:

1. It needs an explicit `/etc/hosts` entry per app (netget already does this
   per-user, via `addLocalHostEntry`) — a real, `sudo`-gated, per-machine
   setup step for every new app, every new dev machine.
2. It reads like it should be backed by NRP's `[selector]` bracket syntax —
   it isn't. Read the spec closely
   (`modules/monad/Typescript/typedocs/NRP-v0.3.0.md`): `selector` in
   `me://namespace[selector]/path` picks a **monad/device instance for an
   already-existing namespace** —

   ```
   me://jabellae.cleaker.me[monadlisa]/profile
   me://jabellae.cleaker.me[monadluis]/profile
   ```

   `monadlisa`/`monadluis` are two of jabellae's *devices*, both answering
   for the *same* namespace `jabellae.cleaker.me`. There is no NRP construct
   for "address a different app without giving it its own namespace" — the
   selector doesn't substitute for the subdomain, it operates one level
   inside it.

What actually solves it: netget already has a **path-based** proxy,
`/monads/:name` (`lua/handlers/monad_proxy.lua`), that looks up a live
`app.id`/`monadName` in the local mesh registry (`apps.json`) and reverse
proxies to its `host:port` — **stripping the `/monads/:name` prefix before
forwarding** (`ngx.req.set_uri(tail, false)`), so the target process sees
clean root-relative paths (`/`, `/me/*`, `/nrp`) exactly as if addressed
directly. No subdomain, no `/etc/hosts` entry, no DNS at all — just a name
that has to already be registered (heartbeating) in the mesh.

`/monads/:name` describes the *mechanism* (which monad answers). Added a
sibling route, **`/apps/:name`** (same handler, same registry lookup — see
`setNginxConfigRoutes.ts`), because from a user/admin perspective FullTrailer
isn't "a monad," it's an app that happens to be *implemented* as one today.
**`/monads/:name` stays as the internal/infra/debug route. GUI code,
templates, and docs should only ever reference `/apps/:name`.** This also
leaves room for a future `/apps/:name` target that *isn't* a monad directly
(a static surface, netget's own built-in admin UI) without renaming anything
public-facing.

### The namespace-resolution gotcha this creates

A monad resolves which `.me` namespace a request is for from the **Host
header** (`http/namespace.ts`'s `resolveNamespace`). Proxying through
`local.netget/apps/fulltrailer/...` means the monad sees `Host:
local.netget` — which does not literally equal its own `ME_NAMESPACE`
(`fulltrailer.<machine-hostname>`), so naively it resolves to the *wrong*
namespace (literally `"local.netget"`).

The fix already existed, unused: `readLocalIdentityNamespace()` aliases
*any* hostname listed in `MONAD_SELF_HOSTNAME` / `MONAD_SELF_ENDPOINT` /
`MONAD_SELF_TAGS` (comma-separated env var) to the monad's own
`ME_NAMESPACE`. Every app's monad needs `MONAD_SELF_TAGS` to include every
mesh host it might be reached through (`local.netget`, the machine's bare
hostname, `127.0.0.1`, …) — see `apps/FullTrailer/monad/.env`. This is
manual, per-app, per-machine configuration today — see "Known gaps."

---

## The three layers

```
this.gui (browser)  ──HTTP+WS──▶  netget (switchboard)  ──HTTP+WS──▶  monad (daemon)
createWsMeRuntime()                /apps/:name proxy,        rootCommandHandler,
                                    strips prefix,             pathResolver.ts,
                                    CORS headers,               /nrp WebSocket
                                    no app logic
```

- **netget** does pure name resolution and reverse proxying. It has no
  opinion about what's behind `/apps/:name` — today it's always a monad,
  but nothing in the routing layer assumes that.
- **monad** (`modules/monad/Typescript`) is a generic, unmodified daemon —
  every app gets its **own instance** of the *same* codebase, configured via
  env vars and a `self.json`, not a fork. FullTrailer's app-specific
  business logic (a Samsara fuel-telematics proxy, photo uploads) stays in
  its **own**, separate Express process — the monad's `app.ts` is a fixed
  router chain with no extension point for custom routes, and that's
  deliberate: folding app-specific logic into the shared daemon would make
  every future app carry every other app's routes.
- **this.gui** (`createWsMeRuntime`) is the client adapter — the only piece
  that's genuinely new code, not existing infrastructure finally wired up.

---

## The live-semantic loop, in detail

### Server side (generic — lives in `modules/monad/Typescript`, benefits every app)

- `kernel/pathNotify.ts` — new, small, in-process pub/sub:
  `subscribe(namespace, path, cb)` / `notify(namespace, path)`. Matches a
  write to a subscriber if paths are equal or one is a dotted-prefix of the
  other. Single-process only — see "Known gaps."
- Hooked into `handlers/commandHandler.ts`'s `rootCommandHandler` (the real
  `POST /` write path — **not** `meCommandHandler`, which only handles
  kernel `claim`/`open`, a naming trap worth remembering) right after the
  existing `saveSnapshot()` call.
- `http/nrpHandler.ts`'s `/nrp` WebSocket handler gained `read` / `subscribe`
  / `unsubscribe` client message types (alongside the pre-existing
  `nrp.open` → `resolved` resolution handshake, previously the *only* thing
  this socket did — used by `this.gui`'s `Beatle` component, which had zero
  real callers anywhere before this). On `subscribe`, replies immediately
  with the current value (`data`), then pushes a `stream` message with the
  fresh value every time `pathNotify` fires for that path, until
  `unsubscribe` or the socket closes.

### Client side (generic — lives in `this.gui`, published as `2.3.0`)

- `createWsMeRuntime(me, {semanticNamespace, transportOrigin})` — a
  `RuntimeAdapter`. Reads/writes go over HTTP (`this.gui`'s own
  `monadClient.ts`); `subscribe`/`getSnapshot` ride one shared `/nrp`
  WebSocket connection, deduped per path across however many local
  `useMeValue`/`{read: ...}` callers are watching it. An incoming live value
  gets written into the **local** `me` object (`writeMeValue`) and a local
  store notified — `useMeValue`'s `getSnapshot` always reads straight from
  `me`, not from the adapter, so this is what actually makes a live update
  visible to a component, not a side detail.
- Must be passed **explicitly** — to `MeRuntimeProvider`'s `runtime` prop,
  and separately to any standalone `SpecBoundary` (not context-aware on its
  own; pull it via `useOptionalMeRuntimeContext()?.runtime`). Omitting it
  silently falls back to a no-op identity adapter — same visible symptom
  (a `{read: ...}` token echoes its own path string) as forgetting the `me/`
  prefix on the path itself (the renderer's expression allowlist blocks
  anything else). Two different bugs, same symptom — check both.

---

## Recipe: wiring a new app this way

FullTrailer did every step of this by hand; nothing below is automated yet
(see "Known gaps" — this is exactly what templating should eventually
generate).

1. Pick a name (`myapp`). Generate a fresh `SEED` (`openssl rand -hex 32`) —
   don't reuse another app's or a personal identity's seed.
2. `myapp/monad/self.json` — `identity: "myapp.<machine-hostname>"`,
   `monadName: "myapp"`, its own `endpoint`/port.
3. `myapp/monad/.env` — `SEED`, `ME_NAMESPACE` (matches `self.json`'s
   `identity`), `MONAD_NAME`, `PORT` (pick one not already in use),
   `ME_STATE_DIR` and `MONAD_SELF_CONFIG_PATH` as **absolute** paths (the
   monad process runs from its own checkout's directory, not the app's —
   relative paths resolve against the wrong cwd), `MONAD_SELF_TAGS` listing
   every mesh host this app should answer to (`local.netget`, the machine's
   bare hostname, `127.0.0.1`).
4. A small run script that sources `.env` and runs
   `modules/monad/Typescript`'s `tsx watch server.ts` from *its own*
   directory — don't copy the monad codebase into the app's repo.
5. Frontend: `createWsMeRuntime(me, { semanticNamespace:
   'myapp.<machine-hostname>', transportOrigin:
   'http://local.netget/apps/myapp' })`, passed to `MeRuntimeProvider` (and
   to any `SpecBoundary` used outside the package's own `mountApp()`).
6. Regenerate + reload netget's config so the new `/apps/myapp` traffic is
   nothing new — the route already exists generically, this step is only
   needed the first time `/apps/:name` itself is added to a given gateway
   install, not per-app.
7. Verify with the exact three-client test this doc opens with, before
   trusting it: an external `curl` write, two open tabs, no refresh.

---

## Known gaps — read before building a second app on this

- **No real auth beyond loopback trust.** `/apps/:name` and `/monads/:name`
  rely on the same trust model every other loopback-only netget route uses
  today. Fine for local dev, not evaluated for anything beyond that.
- **`MONAD_SELF_TAGS` is manual, per-app, per-machine.** Nothing generates
  or validates it; get it wrong and writes silently land in a namespace
  named after whatever Host header happened to reach the monad.
- **`pathNotify` is single-process, in-memory.** No fan-out across multiple
  monad instances or processes. Fine for "one app, one monad, one machine";
  not a distributed pub/sub.
- **No WebSocket write path.** Writes are HTTP-only, applied optimistically
  to the local `me` object before the network call resolves. A failed write
  is logged to the console, not surfaced to the UI — no retry, no rollback
  of the optimistic value.
- **Not templated.** `npx this.gui my-app` does not generate any of this
  yet — every piece in the recipe above was hand-wired for FullTrailer.
- **This doc, not code, is the only place the `/monads/:name` vs.
  `/apps/:name` naming decision is recorded.** If `/apps/:name` ever grows a
  backing implementation that isn't `monad_proxy.lua`, update this doc in
  the same change.
