# Gateway access contract (doors migration)

Draft for review, 2026-09-21. Nothing here is implemented. It is the access part of the doors migration already
agreed (see [Front-end navigation](./FrontEndNavigation)): `netget.site` and `cleaker.me` are two doors onto one
namespace.

Legend: **[code]** read in the repository, **[conf]** the VM's installed nginx configuration, **[live]** observed on
the public hosts on 2026-09-21 (read-only requests; the only POSTs were empty-body ones that no handler could act on).

## 1. The rule

> Same proven identity, same path, same operation, same state → same result, through either door.

- The door carries the request. **The state of the tree decides** what an identity may read or write.
- Without a session, both doors receive an anonymous request and apply the same rules.
- Having an account is not enough: **each request must prove the identity** it acts as. A browser session is not
  shared automatically between domains (section 2 says where the identity lives instead).

## 2. Where identity lives

- The namespace, the identity and the session belong to the **running (local) monad**, not to a page and not to an
  origin. Pages on different domains connect to that one context; changing domain does not mean signing in again.
- Authenticating and authorizing a page are different things: it is still the same person, and each site can use
  only the capabilities that person granted it.
- The present implementation keeps sessions and vaults **per origin** (browser storage). That is a limitation of the
  implementation, not the behaviour sought. This contract only requires that the proof arrive with the request; how a
  page obtains it from the runtime belongs to the identity-vault / runtime migration, not to this document.
- Open: when no local monad is running (another device), which monad holds the session. Default in the identity-vault
  design: the serving monad. Not decided here.

## 3. What a door may and may not do

| A door may (transport) | A door may not |
|---|---|
| TLS termination, HSTS | decide what the tree lets an identity read or write |
| Origin validation for browser calls (it stops another site's page from using a grant; it never grants) | treat "same machine", loopback, `Host: localhost` or any header as permission |
| Rate and size limits | change the answer for the same proven identity and state |
| Select the namespace a request names | hold a second copy of the rules (Lua and the monad today) |

## 4. The machine is an identity with declared capabilities

Today `x-monad-internal-token` marks the machine's own callers [code: `monad/src/http/internalToken.ts`], and the
gate treats an internal request as authorized for everything that is not public [code: `adminGate.mjs`]. A local
caller is not thereby unlimited.

- Define which identity the token represents (a machine identity of this monad) and give it **explicit capabilities**,
  each tied to a real caller: e.g. register a monad in the app registry (heartbeat), write gateway routing records,
  run OpenResty control (netget CLI / operator).
- No capability is granted because a request is local. The list of callers and the minimum each needs is an inventory
  still to be made (open, section 7).

## 5. Routes: today and under the contract

"Today" columns are what each door does now. Under the contract every row has one rule: **the datum's path in the tree
plus the caller's proven identity decide**; the last column says what that means, and what is known about the datum.

| Route | Op | Today: cleaker.me (monad gate) | Today: netget.site | Datum / decided by |
|---|---|---|---|---|
| `/gateway-identity` | read | public [live] | public, same answer since 2026-09-21 [live] | `daemon.gateways.<gatewayId>` (owner, admins) |
| `/main-server-namespace`, `/cleaker/resolve` | read | public | public | tree; unchanged |
| `/domains`, `/domains/:parent/subdomains` | read | public, **includes certificate paths** [live] | public [live] | `users.netget.domains…` (in the tree); fields that are server internals closed by default |
| `/apps` | read | public, **includes each monad's working directory** [live] | **403** from Lua (loopback only) [live] | apps registry (`apps.json`, a file, not in the tree) |
| `/openresty-status` | read | public, **includes the binary path** [live] | **401** from Lua [live] | server status; internals closed by default |
| `/frontend-mode`, `/apps/:name/frontend-mode` | read | public, **includes directory roots** [live] | no nginx location for `/frontend-mode` (falls to the static SPA); `/apps/:name/__frontend-mode` is proxied [conf] | as above |
| `/ip-info`, `/port-info`, `/healthcheck` | read | public | public | tree/none |
| `/logs` | read | own auth: bearer session [live 401 without] | 401 [live] | log read capability for the identity |
| `/setup/*` | write | own auth: signed setup | proxied | unchanged: signed by the claiming identity |
| `/admin-session/*` | write | own auth | proxied | unchanged: challenge signed by the identity |
| `/gateway-admin/{grant,revoke,transfer}` | write | own auth: signed | **no nginx location** (falls to the static SPA) [conf] | `daemon.gateways.<gatewayId>` authority, checked by the monad |
| `/add-domain`, `/update-domain`, `/delete-domain`, `/provision-cert`, `/domains/metadata` | write | **401** without a session with `gateway:write` (owner has it) [live] | **403 from nginx** (`limit_except GET HEAD OPTIONS { allow 127.0.0.1; deny all }`) before the monad can look at any session [conf, live] | write on the domain's path; owner/admin from `daemon.gateways.<id>` |
| `/openresty-restart`, `/openresty-stop` | write | as above (session or internal) | Lua: loopback only | OpenResty control capability |
| `/frontend-mode`, `/apps/:name/frontend-mode` | write | as above | no nginx location for `/frontend-mode` [conf]; the `__frontend-mode` variant is proxied | as above |
| `/apps/report`, `/apps/release`, catalog routes | write | internal token (not a person) | Lua: loopback only | machine identity capability (section 4) |
| `/__gateway/claim` | write | internal token | — | machine identity capability |
| `/openresty/install*` | read/write | default `trusted` [code] | — | OpenResty control capability |

Two rows break the rule today for a reason the person cannot influence: an authorized identity gets **403 at
netget.site** and would succeed at cleaker.me, and the same anonymous read of `/apps` is 403 in one door and 200 in
the other.

## 6. Equivalence tests

A table-driven test on disposable infrastructure (a monad, a real generated OpenResty as in `gateway-edge-access`,
two or more hostnames). For every route of section 5:

- identities: anonymous · non-admin identity · admin with `gateway:write` · owner · revoked admin · machine identity
  (each capability, and one without it);
- doors: netget-shaped host, cleaker-shaped host, `www`, a handle host;
- assert the **same status and the same body shape** across doors for each identity. Known-red today: `/apps`,
  `/openresty-status` (anonymous), every write with a valid session (netget.site);
- assert that spoofing a door changes nothing: `Host: localhost`, `X-Forwarded-Host`, a loopback peer address, a
  forged internal-token header sent from outside;
- assert that transport protections still hold and decide nothing else: a foreign-origin browser call is refused for
  every identity; TLS/redirect behaviour is unchanged; a session presented from an origin that was not granted the
  capability is refused (this last case depends on the runtime side of section 2).

## 7. Open decisions

1. **Default disclosure.** Which fields of the public reads are closed to an anonymous identity by default
   (certificate paths, working directories, binary and directory paths are the candidates). Written as tree state,
   not as a filter in code.
2. **Machine capabilities.** The exact list, from an inventory of the internal callers (monad heartbeat, netget CLI,
   Lua handlers, `monads` CLI).
3. **Apps registry.** Move `apps.json` into the tree, or expose it as a view whose read rule is a tree path.
4. **Session holder without a local monad** (section 2).

## 8. Order after acceptance (not started)

1. Inventory the data and the internal callers; fill section 5's last column with real paths.
2. One guard, a function of (proven identity, path, operation) over tree state, used by both doors.
3. `netget.site` sends these routes to the monad (as `/gateway-identity` already does) and stops deciding in Lua; keep
   the nginx loopback limits on destructive routes as a second layer until the equivalence tests pass.
4. The dashboard presents the proof it has instead of calling routes that cannot authorize it.
5. The equivalence tests become part of `npm test`.
