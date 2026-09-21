# Front-end navigation map

How a request becomes a screen today, on the two hosts that matter (`cleaker.me` and `netget.site`),
what the target model is, and where they differ. Written 2026-09-21 from code and from a read-only copy of
the VM's installed `netget_app.conf`. Nothing here was changed by writing it.

Legend: **[code]** read in the repository, **[conf]** read in the VM's installed nginx configuration,
**[not verified]** inferred, not observed.

## 1. Target model (decided, not yet implemented)

- `netget.site` points at **the same namespace as `cleaker.me`**. Administration may be its *initial screen*,
  but it keeps the tree's routes: `netget.site/x` and `cleaker.me/x` are the same `x`.
- A route resolves to **the component the GUI document declares for that route**, not to one fixed landing.
- Two different things, not to be merged:
  - `/.gateway/*` — the gateway's **control API**.
  - Administrative **screens** — components and routes declared in the GUI document. They do not have to use
    the API's prefix.
- A launcher that names a fixed address (`http://local.cleaker`) contradicts the model: it must use the
  resolved context and transport.
- Unifying the two shells belongs to the doors migration, not to the small presentation fix.

## 2. Today

### 2.1 One bundle, three roles

`frontend_local` builds one bundle (served from `assets/main-server-ui/dist`). `frontendRole({host, boot})`
[code: `frontend_local/src/session/providerBoot.js:46`] picks the role:

| Condition (first match wins) | Role | Renders |
|---|---|---|
| host is `local.cleaker` | `cleaker` | `CleakerLanding`, whole page |
| host is `local.host` | `host` | `HostSurface` |
| a provider boot exists and the host is the namespace or a handle under it | `cleaker` | `CleakerLanding` |
| a provider boot exists and its monad is not a gateway monad | `cleaker` | `CleakerLanding` |
| anything else (no boot, or a gateway monad on a non-namespace host) | `gateway` | `NetGetShell` |

The boot (`window.__MONAD_NAMESPACE_PROVIDER_BOOT__`) is injected by the monad when *it* hands out
`index.html`.

### 2.2 `cleaker.me` (and `www`, and `<handle>.cleaker.me`)

- nginx [conf]: one `server` with a single `location /` → `surface_proxy.lua` → the namespace's monad. **No other
  location**: every path goes to the monad.
- SPA role `cleaker` → `CleakerLanding`. Routes come from the GUI document
  [code: `packages/GUI/Typescript/src/runtime/GUI.document.json`]:
  `/`, `/users`, `/blockchain`, `/url`, `/keychain`, `/keychain/claim`, `/keychain/admin-sign`, `/netget`.
- Sidebar [code: `CleakerLanding.tsx:2160`]: Home, the items the namespace declares, Keychain (only with a
  session), Netget → `/netget`.
- `/netget` mounts `MainServerView` (public status) and `GatewaySetup` (claim) against the **confirmed root
  endpoint** (the origin already verified for the sidebar), not a re-derived address.

### 2.3 `netget.site`

- nginx [conf]: one `server` with ~60 top-level `location`s (section 3) and, last, `location /` serving the
  static SPA with `try_files $uri $uri/ /index.html`. Nothing injects a boot, so the role is `gateway`.
- SPA role `gateway` → `NetGetShell` [code: `frontend_local/src/App.jsx`]:

| Route | Screen |
|---|---|
| `/` | `GatewayEntry` → `GatewaySetup` (endpoint `""`, same origin) |
| `/home` | `Home` → `GatewayDashboard` (`/gateway-identity`, `/apps`, polled every 5 s) |
| `/domains` | `Domains` (REST: `/domains`, `/add-domain`, `/delete-domain`, `/provision-cert`) |
| `/logs` | `Logs` (REST: `/logs`) |
| `/terms-and-conditions`, `/privacy-policy` | static pages |

- Sidebar: Home, Dashboard, Domains, Logs. Footer launchers: Dev Tools, Theme, Frontend Mode, `.me`.
- There is **no `/netget`, `/keychain`, `/users`, `/blockchain`, `/url`** route in this shell, and no route for
  any path of the namespace tree. A path that nginx lets through falls back to `index.html`; the shell has no
  matching `<Route>`, so the content area renders nothing **[not verified in a browser]**.
- The `.me` launcher is fixed to `http://local.cleaker` [code: `App.jsx:136`] — the contradiction named in
  section 1.

### 2.4 Where the two disagree

| | `cleaker.me` | `netget.site` |
|---|---|---|
| Same tree path gives the same answer | yes (every path → monad) | **no** |
| Gateway status screen | `MainServerView` (`/netget`) | `GatewayDashboard` (`/home`) — a different component |
| Claim screen | `GatewaySetup` at `/netget` | `GatewaySetup` at `/` |
| Session / keychain | yes | none in this shell |
| `.me` launcher context | resolved | fixed `local.cleaker` |
| Monad link target | — | `/monads/<name>` (old internal alias; public form is `/apps/<name>`) [code: `Home.jsx:26`] |

## 3. Paths `netget.site` answers before the namespace can [conf]

These exist as nginx locations on the `netget.site` server and therefore **shadow** a tree path of the same
name there, while `cleaker.me` would pass the same path to the monad:

- Static/UI: `/assets/`, `/media/`, `/networks`, `/deploy`, and any path ending in
  `.css .js .png .jpg .jpeg .gif .ico .svg .woff .woff2 .ttf .eot`.
- Gateway API: `/gateway-identity`, `/apps` (+ `/apps/report|release|restart-all|catalog…`, `/apps/<name>…`),
  `/monads/<name>…`, `/entrypoints`, `/surfaces`, `/main-server-namespace`, `/setup/*`, `/admin-session/*`,
  `/domains` (+ `/domains/<x>/subdomains`, `/domains/metadata`), `/add-domain`, `/update-domain`,
  `/delete-domain`, `/provision-cert`, `/logs`, `/explain`, `/inspect`, `/openresty-status|restart|stop`,
  `/dev-server-status|start|stop`, `/healthcheck`, `/ip-info`, `/port-info`.
- Identity/session: `/me/*`, `/check-auth`, `/logout`, `/cleaker/resolve`, `/nrp`, `/@…`.

Consequence for the target model: the gateway API has to move under `/.gateway/*` (or otherwise stop sharing
names with tree paths) before `netget.site/x` can equal `cleaker.me/x`. `/domains` and `/logs` are today both
an SPA page and an API route on the same path (nginx tells them apart by `Sec-Fetch-Mode: navigate`, which a browser sets only on real navigations, and rewrites those to `index.html`) — the
clearest case of the API and the screen sharing a name.

## 4. `GatewayDashboard` (netget.site `/home`) — review

Files: `gui/src/compounds/GatewayDashboard/GatewayDashboard.tsx`, `gui/src/molecules/GatewayCard/GatewayCard.tsx`,
`gui/src/compounds/MonadMesh/MonadMesh.tsx`. Same criterion as the `MainServerView` fix: an **absent** fact must
not be shown as a **negative** fact, and different names must not share a field.

| # | Where | What it does | Why it misleads |
|---|---|---|---|
| 1 | `GatewayDashboard.tsx:49` | `adminCount: data.adminCount ?? 0` | A response without the count shows "Admins 0". This is the original `adminCount: 0` symptom from the Lua handler. |
| 2 | `GatewayDashboard.tsx:48` | `bootstrapped: !!data.bootstrapped` | A missing field reads as "unclaimed". |
| 3 | `GatewayDashboard.tsx:46` | `gatewayId: data.gatewayId ?? 'unknown'` | Presents "unknown" as if it were an id. |
| 4 | `GatewayCard.tsx:10–11,49` | Title is `gatewayId`, documented as "hostname / node ID" | Two different facts in one field. The contract now carries `hostname` separately; the card ignores it. |
| 5 | `GatewayCard.tsx:64` | Owner shown only as a hash (`HashLabel`) | The contract carries `ownerUsername`; `MainServerView` shows it, this card does not — the same gateway reads differently on the two hosts. |
| 6 | `GatewayCard.tsx:71` | "Listening on `scheme://ip:port`" | `ip` is the machine's local IPv4 from the contract, not what nginx was verified to listen on. The label claims more than the field says. |
| 7 | `GatewayCard.tsx:21,103` | `updatedAt` typed as ISO string, labelled "snapshot" | The contract sends epoch milliseconds (still renders); "snapshot" describes the cache, while the authority is the monad's canonical branch. |
| 8 | `GatewayCard.tsx:2` | Header says it reads `gateway-claims.json` | Out of date: that file is a cache of the canonical branch. |
| 9 | `MonadMesh.tsx:47` | `Array.isArray(data.apps) ? data.apps : []` | A 200 without `apps` shows "No live monads registered" (a non-2xx or non-JSON reply does show its error). |
| 10 | `MonadMesh.tsx:102–103` | `trust ?? 'guest'`, `exposure ?? 'loopback'` | A missing value is shown as a definite one; "loopback" states the monad is not exposed. |
| 11 | `MonadMesh.tsx:83` | Hint says to call `netget.registerApp()` | Stale instruction. |
| 12 | `Home.jsx:26` | Monad click → `window.location.href = /monads/<name>` | Leaves the SPA through the old alias; the public form is `/apps/<name>`. |

Not a defect, worth knowing: fetch failures do show the real message ("404 Not Found"), which is the honest
behaviour `MainServerView` needed for `/entrypoints`.

Findings 1–3 are fixed locally: missing gateway IDs, claim status, and admin counts now show explicit unavailable states. An explicit `false` still means unclaimed and an explicit `0` still shows zero. `GatewayDashboard` rejects malformed values for these three fields. The `MissingIdentityFields` story covers a successful but incomplete response. Two neighbours of the same class are closed as well: a missing `owner` shows "Owner unavailable" (an explicit `null` still shows "not set") and a missing `scopes` shows "Not available" (an explicit `[]` still shows 0). The mapping lives in `gui/src/compounds/GatewayDashboard/identityView.ts` and is covered by `tests/gateway-identity-view.test.ts` (part of `npm test`). Findings 4–12 remain pending; this does not imply deployment.

## 5. What is still unknown

- What `netget.site/<unknown path>` renders in a browser (section 2.3 is from the route table).
- Whether the monad, when it serves `index.html` for `cleaker.me/<any path>`, always falls back to the SPA for
  paths the tree does not declare (it worked live for `/netget`; the general rule is not read).
- Whether any client still depends on the API being reachable at the top-level paths listed in section 3
  (`/domains`, `/apps`, `/gateway-identity`, `/setup/*`, `/admin-session/*`); moving them needs that inventory.

## 6. Order of work implied (nothing started)

1. Inventory consumers of the section 3 paths (GUI, CLI, monads' registration, tests, docs).
2. Introduce `/.gateway/*` as the control API next to the existing paths; move consumers; then retire the old
   names on the `netget.site` server.
3. Declare the administrative screens in the GUI document as routes with their own components.
4. Make `netget.site` resolve tree routes through the same document as `cleaker.me`, with admin as the initial
   screen; drop the fixed `local.cleaker` launcher in favour of the resolved context and transport.
5. Apply the section 4 corrections (independent of 1–4).
