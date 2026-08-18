# Domain Store Split-Brain

Architecture debt note, written while the shape is fresh (2026-08-17). Not fixed here — this is a
record of a real gap found while wiring the [Gateway Capability Model](./GatewayCapabilityModel.md)'s
UI, kept deliberately separate from that work. The capability model governs *who can write*; this
note is about a different problem — *what "write" even means* for the admin `/domains` surface,
because today it doesn't reliably mean anything to real routing.

---

## The gap

There are two independent, disconnected places domain data can live:

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

## Future fix (not attempted here)

Migrate `/domains`, `/add-domain`, `/update-domain`, `/delete-domain`, and the cert/provision flows
off `domains.lua`'s direct SQLite access, onto the same TypeScript/kernel-backed daemon path
`domainStore.ts` already provides — the same direction of migration already underway for capability
enforcement (Lua verifies and forwards, a narrow daemon surface decides and persists). Once both
migrations land, `domains.lua` stops being a second, independent write path entirely.

Until then: **do not trust `POST /add-domain` (or `/delete-domain`, `/update-domain`) to reflect real
routing.** Verify with `netget generate-domain-map` or by inspecting `~/.get/runtime/domain-map.json`
directly.

## Related

- [DomainMap.md](./DomainMap.md) — what `domain-map.json` is and how it's regenerated.
- [GatewayCapabilityModel.md](./GatewayCapabilityModel.md) — the separate, unrelated capability-model
  work this note was found alongside. Don't conflate the two: that work is about *who* may cause a
  write; this note is about *whether the storage a write lands in is the one that matters*.
