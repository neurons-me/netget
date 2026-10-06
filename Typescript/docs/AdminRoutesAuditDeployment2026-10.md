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

**Rebuilt 2026-10-06** to apply cleanly on current `main` (PR #17 was
originally opened from a much older branch that also carried a large,
unrelated, unmerged frontend migration — see "Scope correction" below).
Base: `origin/main` at the time of rebuild (`9442d7a`). 15 commits,
chronological order, no dependency on anything outside this list:

| # | SHA | Protects against |
|---|---|---|
| 1 | `62a118b` | GET/HEAD bypass on control-action routes (openresty-restart/stop, dev-server-start/stop) — a bare GET with zero credentials could execute the action |
| 2 | `b379d20` | Unauthenticated loopback + unquoted `cwd` shell interpolation on catalog upsert/delete/spawn — full RCE chain |
| 3 | `deceb66` | Docs only: records that the catalog-upsert grant is effectively code execution |
| 4 | `e21088c` | `/apps/report` accepted any caller-claimed port with zero verification — confused-deputy: an attacker-chosen port belonging to an unrelated process could later be targeted by restart-all |
| 5 | `8e22813` | `/networks` had zero authorization baseline (loopback-only was never added) |
| 6 | `de25c61` | `/logs` gated only by loopback while its own CORS headers reflected credentialed cross-origin reads |
| 7 | `6cae470` | `restart-all` required no signed proof/capability at all — verifying the *target* was a real monad was never evidence the *requester* was authorized |
| 8 | `6166fd2` | Test wiring/documentation for #7's follow-on review (`/networks` isolated-storage verification, `/logs` query-signature scope note) |
| 9 | `6bef8d3` | X-Me-Proof signature never bound the query string — a proof signed for a bare path (`/logs`) was valid for ANY query on that path (`?type=access` vs `?type=error`) |
| 10 | `3e14a1b` | Shared-vector tests for #9 |
| 11 | `9541799` | Query canonicalization diverged between client and server for queries that decode to invalid UTF-8 — now rejected consistently (422/401), never silently mismatched or a 500 |
| 12 | `eb4e3bd` | `restart-all` could kill ANY process that merely answered the monad protocol, including one netget never spawned — now requires netget's own spawn record (real pid, captured at spawn time) |
| 13 | `7994978` | Proof that #12's new pid-ownership field cannot be forged via `catalog/upsert` or `/apps/report` |
| 14 | `3a1d3af` | This manifest |
| 15 | `ae1a641` | Empirical (not inspection-only) proof that a new-format signed proof is accepted by the OLD verifier |
| 16 | `2a5fecf` | Consolidated test wiring for all 6 new test files, applied once against `main`'s own (independently-evolved) test list rather than six separate conflicting edits |

**Scope correction (2026-10-06)**: PR #17 was originally built on
`fix/control-action-limit-except-bypass` as it existed before this
rebuild — a branch that also carried a large, separate, unmerged
frontend-shell migration (App.jsx moving from a hand-assembled
`SeedSessionProvider`+`Namespace`+`Router` shell to a unified `Cleaker`
component), which had diverged from `main` by ~314 lines in that one
file alone and was never merged. That work was NOT discarded — it's
preserved at branch `frontend/cleaker-migration-wip` (same repo) for
separate review on its own terms. This PR now carries only the security
fixes, their tests, and this document — nothing from that migration.

**Found during the rebuild, pre-existing in `main`, NOT fixed here**:
`tests/gateway-revoke-admin.test.ts` fails on `main` as-is (confirmed
standalone, independent of this PR: `NETGET_PATH_REQUIRES_CLAIM`,
`GatewayClaimsManager.bootstrapOwner()`'s old unsigned write path
rejected by the real namespace-derived claim model). This PR's own
branch (before the rebuild) had already retired this exact test in favor
of signed live-write coverage, for exactly this reason — but that fix
never reached `main` either, and porting it is a separate claims/
authority-model change, not a security-audit fix, so it's left alone
here. The rest of the suite (every other pre-existing file, plus all 6
new ones) passes clean on top of current `main`.

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

**Merging each PR to `main` triggers that repo's `.github/workflows/docs.yml`** (path filter includes `Typescript/src/**`, which every one of these PRs touches) — confirmed by reading all three workflow files in full, not inferred: each one only installs VitePress, rebuilds the static typedoc site, and publishes it to the `gh-pages` branch via `peaceiris/actions-gh-pages`. **This is real, automatic publication on merge** — it is NOT nothing — but it is documentation publication, never a deploy, restart, or reconfiguration of the real gateway or any running monad instance. Keep this distinction explicit when approving a merge: "merging publishes docs" and "merging deploys the fix" are different claims, and only the first one is true of a bare merge to `main`.

## 2. Deployment order — corrected, with the interruption risk made explicit

**GUI first, netget second.** The earlier proposed order (netget first)
was wrong: it would make every already-deployed client that sends a
query string on a proof-gated route fail immediately (`401
ME_PROOF_QUERY_UNBOUND`) the moment netget's verifier went live, until
each client happened to reload a newer GUI bundle.

Confirmed **empirically**, not just by reading the old verifier's code:
`scripts/verify-query-binding-backward-compat.ts` extracts the real
`middleware/me_sig.lua` as of `ab1b2cb` (the commit immediately before
the query-binding fix) via `git archive`, mounts it on disposable
OpenResty + a disposable monad, builds a genuinely NEW-format signed
proof (challenge includes `query`, signed the same way
`signedRequest.ts`'s `canonicalizeQuery()` does post-`e97ab9fa`), and
sends it to a capability-gated route. The script asserts the extracted
file does NOT contain `ME_PROOF_QUERY_MISMATCH` before running the
request, specifically so this can never silently pass against the wrong
(already-fixed) verifier. Result: `200`, real content returned — the old
verifier accepts the new-format proof exactly as if the extra `query`
field weren't there, because it extracts challenge fields **by name**
(`req.method`, `req.path`, `req.bodyHash`, `req.nonce`, `req.timestamp`)
with no check anywhere that rejects an unrecognized extra one. Run this
script again immediately before step 1 below, as the actual
go/no-go check for GUI-first — not as a re-opening of the audit, a
one-time compatibility confirmation this deployment step depends on.
This is what makes GUI-first safe:

1. **Deploy GUI (`e97ab9fa`) alone first.** Every client that loads the
   new bundle starts signing `query`. The OLD netget verifier, still
   live, ignores that field completely — these requests succeed exactly
   as they did before. Clients still on the OLD bundle (not yet reloaded)
   are completely unaffected either way, since they don't send `query`
   and the old verifier was never checking for it.
2. **Deploy netget (`main..fix/control-action-limit-except-bypass`, PR #17) once GUI has had time to actually
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

- **netget**: redeploy from `main` as it stood before merging PR #17
  (i.e. revert the merge commit, or redeploy the pre-merge `main` SHA).
  This reverts all 15 commits as a unit. A PARTIAL rollback (e.g. keep
  the catalog/networks/logs fixes, revert only the query-binding or
  restart-all pieces) is NOT recommended without re-checking dependencies
  first — `9541799` depends on `6bef8d3`'s `lib/query_canon.lua`;
  `eb4e3bd`/`7994978` depend on each other (the ownership check and its
  own non-forgeability proof).
- **monad**: redeploy from `da1be95f` instead of `1d174752`. Reverts both
  commits as a unit; they're independent of each other but there's no
  reason to keep one without the other.
- **GUI**: redeploy from `ab1925ba` instead of `e97ab9fa`. Reverting this
  ALONE (while netget's range is still deployed) recreates exactly the
  interruption risk described in §2 — clients would stop signing
  `query`, and netget's verifier would then reject every query-bearing
  proof-gated request from them (`ME_PROOF_QUERY_UNBOUND`). If only one
  of the two needs to roll back, prefer rolling back netget's merge
  entirely (or at least to before `6bef8d3`) rather than rolling back
  GUI alone.

---

## 5. Known residual risk — ships WITH the release notice, not separately

- **netget's own `tests/gateway-revoke-admin.test.ts` fails on `main` as
  of this rebuild, independent of this PR** (`NETGET_PATH_REQUIRES_CLAIM`
  — the old unsigned `bootstrapOwner()` write path rejected by the real
  namespace-derived claim model). See "Scope correction" under §1 above
  for the full context; not fixed here, not newly introduced here.
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
