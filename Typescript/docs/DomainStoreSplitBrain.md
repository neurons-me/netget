# Domain Store Split-Brain

**Status: Fixed (2026-08-17).** Originally written as an architecture debt note the same day it was
found, while wiring the [Gateway Capability Model](./GatewayCapabilityModel.md)'s UI, kept
deliberately separate from that work. Migrated the same day, as its own separate change — the
sections below describe the gap as it was, kept for the record, plus what actually closed it.

---

## The gap (as it was)

There were two independent, disconnected places domain data could live:

1. **`kernel/domainStore.ts`** — the intended source of truth. Genuinely `.me`-kernel-backed: domains
   are stored as kernel paths (`me.domains.<hostname>.target`, etc.), in `~/.get/kernel/snapshot.json`.
   The module's own header says so directly: *"Drop-in replacement for sqlite/utils_sqlite3.ts — same
   public API, zero native dependencies."* Every TypeScript call site — the `netget` CLI (`domains.cli.ts`,
   `routingTable.cli.ts`), certbot flows, `netgetSync.ts` — goes through this.
2. **`~/.get/domains.db`** (SQLite) — used *only* by
   `src/modules/NetGetX/OpenResty/lua/handlers/domains.lua`, the Lua handler behind the HTTP admin API:
   `GET /domains`, `POST /add-domain`, `/update-domain`, `/delete-domain`, `/get-domain-target`. This is
   exactly the surface `Domains.jsx` (the local dev admin UI) calls. It shells out to the `sqlite3` CLI
   (`io.popen("sqlite3 -json ...")`) and never touches the `.me` kernel.

`domain-map.json` — the file OpenResty's Lua routing hot path actually reads (cached in
`_G.DOMAIN_MAP`, refreshed by a 1-second timer; see [DomainMap.md](./DomainMap.md)) — is generated
by `generateDomainMap()` (`src/runtime/domainMap.ts`), which reads **exclusively** from
`kernel/domainStore.ts` (store #1). It has no path to SQLite at all.

`domains.lua` writes call `bump_domain_map_version()` after every mutation — but that only writes a
new timestamp to `domain-map.version`, which tells the 1s Lua timer to *re-read the existing
`domain-map.json` file off disk*. It does not regenerate that file from SQLite. Nothing in the
codebase does. The handler's own comment concedes exactly this:

> "the actual domain-map.json re-generation happens in the TypeScript layer... here we just signal
> a version change so the next netget process call regenerates it"

No such "next netget process call" exists for a SQLite-originated write. `sqlite/migrate.ts` and
`migrateTable.ts` exist in the repo but have zero importers anywhere — dead, not a running sync.

## Why this is dangerous

`POST /add-domain` (via SQLite) returns `{ success: true }` and the row appears in the admin UI's own
table (`GET /domains`, also SQLite) — every visible signal says the write worked. But
`generateDomainMap()` never reads that row, so it is invisible to `domain-map.json` and therefore to
actual routing. **This fails semantically, not technically** — no error, no 500, no log line
indicating divergence, just a domain that the admin UI believes exists and OpenResty has never heard
of. The reverse is also true: a domain registered through the `netget` CLI (kernel-backed) won't
show up correctly if `domains.lua`'s SQLite-backed list/update/delete ever needs to touch it, since
that handler doesn't know the kernel exists either.

## Not a new problem

This predates and is unrelated to the Gateway Capability Model work. It's the same shape of issue as
`domains.lua`'s legacy JWT/cookie auth (see decision 3 in
[GatewayCapabilityModel.md](./GatewayCapabilityModel.md)) — `domains.lua` simply predates the
kernel-backed rewrite and was never migrated, on either its auth or its storage. Both are legacy
holdovers from before `domainStore.ts` existed, not deliberate design choices to keep two stores.

## How it was fixed

`domains.lua` deleted entirely (`lua/handlers/domains.lua`, source and the live installed copy).
`/domains`, `GET /domains/:parent/subdomains`, `/add-domain`, `/update-domain`, `/delete-domain`,
and `/provision-cert` are now nginx `location` blocks that `proxy_pass` to the daemon
(`localNetget.js`), exactly the same shape as `location = /domains/metadata` — no Lua business
logic left in any of them, verify-and-forward only (here, that's just "loopback-only," enforced by
nginx itself, same trust model the daemon already used everywhere else).

The daemon's new routes call `kernel/domainStore.ts` directly — `getDomains`, `registerDomain`,
`updateDomain`, `deleteDomain`, `getDomainByName` — the same kernel-backed store the `netget` CLI
already used. One real wrinkle: `localNetget.js` is a standalone Express project outside the pnpm
workspace, with zero TypeScript tooling, so it had no way to import a `.ts` file before this. Fixed
by adding `tsx` and a `this.me` `file:` dependency to its own `package.json` (mirroring
`frontend_local`'s `this.gui` dependency) and running it under `tsx` via PM2
(`ecosystem.config.cjs`'s `interpreter` field) instead of plain `node` — no separate compile step to
keep in sync, no subprocess-per-request cost.

Because every mutating `domainStore.ts` function already calls `regenerateMap()` internally, this
wasn't just relocating the split — `domain-map.json` now updates automatically on every write,
closing the actual gap (`bump_domain_map_version()` used to bump a version file nothing then
regenerated from). Verified directly: `POST /add-domain` through `local.netget`, and the new domain
appeared in `~/.get/runtime/domain-map.json` immediately, with no manual
`netget generate-domain-map` step — the regression test this doc exists to have.

`GET /domain-target` (`domains.lua`'s `get_domain_target` action) was already dead — no nginx
`location` referenced it — so it wasn't migrated, just dropped along with the rest of the file.

## Related

- [DomainMap.md](./DomainMap.md) — what `domain-map.json` is and how it's regenerated.
- [GatewayCapabilityModel.md](./GatewayCapabilityModel.md) — the separate, unrelated capability-model
  work this note was found alongside. Don't conflate the two: that work is about *who* may cause a
  write; this note is about *whether the storage a write lands in is the one that matters*.
