# Gateway/monad admin-routes audit — deployment manifest

**Status: implementation and tests closed, locally. Nothing in this
manifest is deployed. The real ambient gateway and the real monad(s) this
installation runs do not have any of these fixes yet.** This document is
the handoff artifact for *when* that deployment is decided — it does not
authorize or schedule it.

Scope: the full "audita las demás rutas administrativas de netget y
monad" pass — every commit below exists because a specific, live-verified
gap was found and closed on disposable infrastructure (fresh temp
OpenResty + fresh disposable monad instances, never the real ambient
gateway/monad). No commit here touches `.me`.

---

## 1. Complete commit manifest

Each branch also carries other, unrelated prior work further back in its
history (pre-dating this audit) — not listed here. The ranges below are
the full, contiguous set of commits this specific audit pass produced, in
chronological order (oldest first), so that deploying "this branch's tip"
deploys every protection below and nothing is silently left out of a
partial cherry-pick.

### `modules/netget` — branch `fix/control-action-limit-except-bypass`

Base (commit immediately before this audit's first commit): `6cfea1c`.
19 commits, `6cfea1c..196d52c`:

| # | SHA | Protects against |
|---|---|---|
| 1 | `6cb841e` | GET/HEAD bypass on control-action routes (openresty-restart/stop, dev-server-start/stop) — a bare GET with zero credentials could execute the action |
| 2 | `edd5c39` | (test wiring for #1) |
| 3 | `5434f2f` | Unauthenticated loopback + unquoted `cwd` shell interpolation on catalog upsert/delete/spawn — full RCE chain |
| 4 | `4544796` | (test wiring for #3) |
| 5 | `df6a059` | Docs only: records that the catalog-upsert grant is effectively code execution |
| 6 | `f0a5e1e` | `/apps/report` accepted any caller-claimed port with zero verification — confused-deputy: an attacker-chosen port belonging to an unrelated process could later be targeted by restart-all |
| 7 | `26943ab` | (test wiring for #6) |
| 8 | `4decb4c` | `/networks` had zero authorization baseline (loopback-only was never added) |
| 9 | `33135a9` | (test wiring for #8) |
| 10 | `e18b9c5` | `/logs` gated only by loopback while its own CORS headers reflected credentialed cross-origin reads |
| 11 | `fd560ee` | (test wiring for #10) |
| 12 | `ab1b2cb` | `restart-all` required no signed proof/capability at all — verifying the *target* was a real monad was never evidence the *requester* was authorized |
| 13 | `e0a1b83` | (test wiring/documentation for #12's follow-on review) |
| 14 | `e2b9694` | X-Me-Proof signature never bound the query string — a proof signed for a bare path (`/logs`) was valid for ANY query on that path (`?type=access` vs `?type=error`) |
| 15 | `086d61b` | (shared-vector tests for #14) |
| 16 | `72082f7` | (test wiring for #15) |
| 17 | `84f07a4` | Query canonicalization diverged between client and server for queries that decode to invalid UTF-8 — now rejected consistently (422/401), never silently mismatched or a 500 |
| 18 | `70bc6cb` | `restart-all` could kill ANY process that merely answered the monad protocol, including one netget never spawned — now requires netget's own spawn record (real pid, captured at spawn time) |
| 19 | `196d52c` | (proof that #18's new pid-ownership field cannot be forged via `catalog/upsert` or `/apps/report`) |

### `modules/monad` — branch `fix/monads-control-null-origin-bypass`

Base: `da1be95f`. 2 commits, `da1be95f..1d174752`:

| # | SHA | Protects against |
|---|---|---|
| 1 | `fab9abed` | `Origin: null` (sandboxed iframes / `data:` URIs) was treated the same as "no Origin header at all" on `/__monads` control plane — a classic CSRF bypass technique |
| 2 | `1d174752` | `/api/v1/session/cloud` and `/api/v1/session/host-verify` issued signed tokens and wrote "authorized host" records from caller-supplied data with no identity check at all — disabled (410), found to have zero real callers anywhere in this monorepo and to predate the real signed-identity model (`keychain.ts`) by ~4 months |

### `packages/GUI` — branch `fix/main-server-port-unavailable`

Base: `ab1925ba`. 1 commit, `ab1925ba..e97ab9fa`:

| # | SHA | Protects against |
|---|---|---|
| 1 | `e97ab9fa` | Client-side half of #14 above — `signedRequest.ts`'s `canonicalizeQuery()` now includes the query string in what gets signed |

`ab1925ba` itself (`fix(Cleaker): default transportOrigin to cleakerEndpoint...`) is **not** part of this audit — it's an earlier, unrelated fix (the login/Users/Blockchain 404 diagnosis) that happens to sit on the same branch, one commit below this audit's own work. Noted here only so deploying this branch's tip doesn't surprise anyone with an unlisted change riding along.

---

## 2. Deployment order — corrected, with the interruption risk made explicit

**GUI first, netget second.** The earlier proposed order (netget first)
was wrong: it would make every already-deployed client that sends a
query string on a proof-gated route fail immediately (`401
ME_PROOF_QUERY_UNBOUND`) the moment netget's verifier went live, until
each client happened to reload a newer GUI bundle.

Confirmed directly from the OLD verifier's own code (`ab1b2cb`'s version
of `me_sig.lua`, read before writing this, not assumed): it extracts
challenge fields **by name** (`req.method`, `req.path`, `req.bodyHash`,
`req.nonce`, `req.timestamp`) and has no check anywhere that rejects an
unrecognized extra field. A new-format proof carrying `query` is
therefore accepted by the OLD verifier exactly as if `query` weren't
there at all — it's decoded into the Lua table and simply never read.
This is what makes GUI-first safe:

1. **Deploy GUI (`e97ab9fa`) alone first.** Every client that loads the
   new bundle starts signing `query`. The OLD netget verifier, still
   live, ignores that field completely — these requests succeed exactly
   as they did before. Clients still on the OLD bundle (not yet reloaded)
   are completely unaffected either way, since they don't send `query`
   and the old verifier was never checking for it.
2. **Deploy netget (`6cfea1c..196d52c`) once GUI has had time to actually
   reach real clients.** "Time to reach real clients" is a judgment
   call, not a fixed number — enough that the overwhelming majority of
   active sessions have reloaded (new tab, natural navigation, or a
   deploy that forces a reload) since step 1.
3. **Deploy monad (`da1be95f..1d174752`) whenever** — independent of
   steps 1-2, no ordering dependency either direction.

**Residual risk this order does not remove, stated explicitly, not
implied away:**

- **Between step 1 and step 2, the query-binding protection is NOT yet
  active.** The original gap (a proof signed for a bare path works for
  any query on it) stays open on the real, deployed gateway until step 2
  actually lands. Deploying GUI first buys compatibility, not an earlier
  close of the gap.
- **A tab already open with the OLD GUI bundle, left open across step 2,
  will start failing** the first time it sends a query-bearing request
  to a proof-gated route, from the moment netget's new verifier goes
  live — with a clean `401 ME_PROOF_QUERY_UNBOUND`, not a silent
  failure or data corruption, but a real, user-visible break until that
  tab is reloaded. This cannot be fully eliminated by any server-side
  sequencing — only reduced by giving step 1 enough time before step 2,
  and by expecting (not being surprised by) a knock-on support question
  of "it suddenly logged me out of admin actions" from anyone who had
  the gateway's admin panel open across the netget deploy.
- Deploying netget's range also activates the `restart-all`
  process-ownership requirement (#18 above) — any monad on the real
  gateway that was started any way OTHER than through netget's own
  catalog (`/apps/catalog/spawn`) will stop being killable by
  `restart-all` the moment this range deploys. If the real deployment
  relies on `restart-all` to cycle a manually-started monad today, that
  stops working the moment this ships, by design — this needs to be
  known going in, not discovered via a failed restart.

---

## 3. Verifying what's actually deployed

No new version/health endpoint was added for this — consistent with
closing this pass rather than extending it. Use what already exists:

- **netget / monad (server-side):** on the host running the deployed
  checkout, `git -C <checkout> rev-parse HEAD` and compare against the
  SHA this manifest names. If the deployed checkout is a detached
  export rather than a live git checkout, compare file hashes of
  `lua/middleware/me_sig.lua`, `lua/lib/query_canon.lua`, and
  `lua/handlers/apps.lua` against this repo's versions at `196d52c`
  (`git show 196d52c:Typescript/src/modules/NetGetX/OpenResty/lua/middleware/me_sig.lua | sha256sum`, etc.).
- **GUI (client bundle):** compare the hash of the deployed
  `this.gui.umd.js` (at both asset locations —
  `modules/netget/Typescript/assets/namespace-surface/assets/` and
  `modules/netget/assets/namespace-surface/assets/`, per the existing
  sync step in the build docs) against a fresh build from `e97ab9fa`.
  There is no separate version string embedded in the bundle today;
  hash comparison is the available mechanism.

---

## 4. Rollback plan, per component

Valid as of this manifest's date, while each branch's tip is still
exactly the commit named above — if more work lands on any of these
branches before deployment, re-derive the rollback point before relying
on it rather than assuming these SHAs are still the tip.

- **netget**: redeploy from `6cfea1c` (the commit immediately before this
  audit's range) instead of `196d52c`. This reverts all 19 commits as a
  unit. A PARTIAL rollback (e.g. keep the catalog/networks/logs fixes,
  revert only the query-binding or restart-all pieces) is NOT
  recommended without re-checking dependencies first — `84f07a4` depends
  on `e2b9694`'s `lib/query_canon.lua`; `70bc6cb`/`196d52c` depend on each
  other (the ownership check and its own non-forgeability proof).
- **monad**: redeploy from `da1be95f` instead of `1d174752`. Reverts both
  commits as a unit; they're independent of each other but there's no
  reason to keep one without the other.
- **GUI**: redeploy from `ab1925ba` instead of `e97ab9fa`. Reverting this
  ALONE (while netget's range is still deployed) recreates exactly the
  interruption risk described in §2 — clients would stop signing
  `query`, and netget's verifier would then reject every query-bearing
  proof-gated request from them (`ME_PROOF_QUERY_UNBOUND`). If only one
  of the two needs to roll back, prefer rolling back netget to
  `6cfea1c` (or at least to before `e2b9694`) rather than rolling back
  GUI alone.

---

## 5. Known residual risk — ships WITH the release notice, not separately

- **monad's test suite is not fully green.** 5 test files fail
  reproducibly, confirmed identical with and without this audit's
  `session.ts` change (checked against the stashed prior version, not
  assumed): `claimSemanticSeeds.test.ts`, `claimsOpenProfile.test.ts`,
  `hostProjection.test.ts`, `replayCanonicalization.test.ts`,
  `semanticBootstrap.test.ts`. One or two additional files flake
  intermittently across runs (`stateDirLockRace.process.test.ts`,
  `appAuthorization.test.ts`) — a separate, already-known class of
  flakiness, not newly introduced.
- **`restart-all`'s pid-ownership check narrows, does not eliminate, pid
  reuse.** If the process netget recorded a pid for has since exited and
  the OS reassigns that exact pid number to an unrelated process that
  ALSO happens to answer the monad surface protocol, the ownership check
  alone would not catch it — mitigated (not closed) by requiring the
  fresh protocol probe to also succeed at kill time.
- **Historical `session.ts`/`host.*` records are not purged.** The two
  surviving read endpoints (`GET /api/v1/hosts/:username` and its
  history variant) still read whatever's already in a given
  installation's real kernel storage from before this fix. Nothing was
  deleted automatically, per instruction; any pre-existing fabricated or
  legitimate records from before the disable remain exactly as they
  were, readable, until or unless something else purges them.
- **Full inventory status**: `keychain.ts`, `gatewayAuthority.ts`, and
  the mesh/claims routers (`meshMonads.ts`, `meshResolve.ts`,
  `meshWeights.ts`, `claims.ts`, `claimSemantics.ts`) were reviewed with
  no new findings in that review — this is not a claim of complete
  security, only that this specific pass found nothing actionable there.
