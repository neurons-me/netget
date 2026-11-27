# Connect with Facebook

How the "Connect with Facebook" button is meant to work, where the namespace's Facebook App ID lives today, and what is still missing before it works on the VM.

This is the operator and implementer note. The model for `keys.namespace` itself is in [NamespaceNetgetModel](./NamespaceNetgetModel.md) (section 3).

Nothing in this document is a secret. The Meta App Secret is never logged, never written into these docs, and never returned to the browser. In production it is typed by the operator and lives only on the exchange server (today, in the server environment; later, in a server-readable tree entry).

## End-to-end flow

1. The person is signed in on the namespace. The identity card loads `useFacebookConnect`. That hook asks the **same origin** for the public App ID: `GET /oauth/facebook/app`. The button is enabled only when that call returns an `appId`. The App Secret is not in the response and is not in the browser module (`facebookConnect.ts`).
2. On click, the browser builds a PKCE challenge (`S256`), stores only the verifier, state, redirect URI, and namespace in `sessionStorage` (key `me.keys.facebook.oauth` — no secret, no token), and opens Facebook's OAuth dialog with the public App ID and the redirect URI.
3. Facebook sends the person back to `{origin}/oauth/callback` (or `{origin}/` if that callback page is not this window). The browser posts the authorization `code`, the redirect URI, and the PKCE verifier to `POST /oauth/facebook/exchange`. The App Secret does not leave the browser, because it is not there.
4. The exchange server loads the App ID and App Secret, talks only to `graph.facebook.com`, exchanges the code for a short-lived token, then for a long-lived token, and returns `{ token, expires }` to the browser. It never returns the App Secret.
5. The browser uses that user token in memory to list Pages and Instagram accounts, then seals the public references under the encrypted keys vault (`keys.meta.facebook.<page>`, `keys.meta.user`, and related Instagram paths). User tokens are not written to `localStorage` or `sessionStorage` in the clear. The user-level `keys.meta.app` fields are not rewritten.

If `GET /oauth/facebook/app` fails or the exchange is missing, the button shows "Facebook connect is not available."

## Where each piece lives

### Official path (the model)

`keys.namespace.meta.app`, with fields `id`, `secret`, and `redirect`. That branch belongs to the namespace (`cleaker.me/keys.namespace`), not to a person's own `.keys`. The App Secret on that branch is meant to be encrypted for the server key, so the gateway can do the exchange when the owner is not online. That reader is not built yet. See [NamespaceNetgetModel](./NamespaceNetgetModel.md), section 3 and section 4.

### Browser vault (what the Keys card saves today)

The .GUI Keys tree always offers a card for `namespace.meta.app` (`NAMESPACE_META_APP` in `keyVisibility.ts`; the full path under `keys` is `keys.namespace.meta.app`). If the owner types an App ID, App Secret, or redirect there, `saveCustomKeys` seals the fields in the **browser's** encrypted keys vault (`serviceKeyVault.ts`):

- stored in `localStorage`, per origin and namespace
- wrapped with `localIdentityVault` (PBKDF2 + AES-256-GCM under the person's passphrase)
- a fresh random 32-byte data key per service, which then seals the fields with AES-256-GCM
- the namespace and service name are bound in as AAD

There is also a user-level group, `keys.meta.app`, which a person can still have from earlier saves. The connect button no longer reads it. `refreshFacebookAppDisplay` may fill that group's public name and icon from the **public** App ID alone.

After a successful connect, Page and Instagram references are sealed in the same vault under `keys.meta.facebook.<page>` (and related paths). Those are results, not the namespace app credentials.

The browser connect code never sends the App Secret, and never uses a vault-stored secret to talk to Facebook. For the dialog it uses only the public App ID from `GET /oauth/facebook/app`.

**Saving the App ID on the `keys.namespace.meta.app` card does not reach the server today.** It stays in that browser vault. The exchange module has no tree reader yet, and it does not look at the browser vault.

### Server environment (what the exchange uses today)

`Typescript/src/gateway/facebookExchange.ts` resolves credentials in this order:

1. An optional `readFromTree` callback, which would read `keys.namespace.meta.app` (`NAMESPACE_META_APP_PATH`). This callback is a typed hook only. The comment in that file says it needs the hosting permission (encrypt-for-server-key) and kernel/monad work that this module does not include. Nothing in netget implements that reader today.
2. If that is missing or fails, the environment variables `META_APP_ID` and `META_APP_SECRET`. These are the only credentials that can actually run an exchange today. They are a temporary stand-in, not the official copy.

`GET` of the public App ID uses the same order, and returns only `{ appId }`. Missing credentials produce a 503 with the message "Facebook connect is not available." Errors from the tree reader are not logged, because they may contain secrets.

### Future tree path

Once the hosting permission exists, the server reads `keys.namespace.meta.app` from the namespace tree, decrypts it with the server key, and uses that as the official copy. The environment variables remain a fallback until that path is proven. The browser still never receives the App Secret.

## Why the App Secret must be server-only

The App Secret is a server credential for the Meta app. If it entered the browser module, any script on that origin could read it, and it would no longer be possible to tell a real exchange from a copied secret. The design is therefore:

- the browser does PKCE and holds only the public App ID, the code, and the verifier
- only the exchange server holds the App Secret
- the only network destination that receives the App Secret is `graph.facebook.com`
- the official long-term store is a server-readable tree entry, not a file in the repo and not the browser vault

A secret typed into the Keys card is sealed for the person in that browser. That is not the same as encrypting it for the server key, and it must not be uploaded to the exchange.

## Gap: the HTTP routes are not mounted

The exchange helpers and the path constants exist:

- `FACEBOOK_APP_PATH` = `/oauth/facebook/app`
- `FACEBOOK_EXCHANGE_PATH` = `/oauth/facebook/exchange`

Unit tests in `Typescript/tests/facebook-exchange.test.ts` call the functions directly. No other file under `Typescript/src` imports `facebookExchange.ts`.

The gateway mounts routers from `GATEWAY_ROUTERS` in `Typescript/src/gateway/monadModule.mjs`: `setupSession.js`, `localNetget.js`, `openRestyInstall.js`, `adminSession.js`, and `gatewayAdmin.js`. None of those define the Facebook paths.

Until a router is mounted, `GET /oauth/facebook/app` and `POST /oauth/facebook/exchange` are not answers of the gateway, even if the environment variables are set.

A later mount also has to name those paths in `adminGate.mjs`. New routes default to `trusted` (they need an admin session or the internal token) until they are listed. `GET /oauth/facebook/app` has to be reachable by a signed-in person with no gateway admin session. `POST /oauth/facebook/exchange` is not a read-only public route, but it must be reachable the same way, under the existing origin guard (`originGuard` in `monadModule.mjs`), without an admin session.

This document does not wire that mount.

## What is missing before it works on the VM

All of the following, then a deploy that Sui authorizes with "sube". A VM change is not done without that word.

1. **Environment.** Sui types `META_APP_ID` and `META_APP_SECRET` herself on the exchange server. They are not stored in the repo, not printed, and not logged. They are sent only to `graph.facebook.com`.
2. **Routes mounted** on the gateway, including an explicit admin-gate policy so the two paths are reachable without a gateway admin session, as above.
3. **nginx** on `cleaker.me` proxies `/oauth/facebook/*` (and the redirect path the app uses, `/oauth/callback`) to that gateway.
4. **Redirect URI** registered in the Meta app, exactly matching what the window will send, typically `https://cleaker.me/oauth/callback` (or `/` if the callback page is not available).
5. **Deploy** with Sui's "sube".

Until that is in place, the published .GUI button can appear and then fail: the browser asks the live origin for `/oauth/facebook/app`, no such route answers, and connect is unavailable.

## Phase plan: from env to `keys.namespace.meta.app`

- **Now.** Official path in the model is `keys.namespace.meta.app`. The Keys card can record those fields in the browser vault, but the server cannot read them. The only server-side credentials are `META_APP_ID` / `META_APP_SECRET`. The HTTP routes are still unmounted. First make the env-backed exchange work on the VM (routes, nginx, redirect URI, env typed by Sui, then "sube").
- **Next.** Implement the hosting permission (encrypt-for-server-key) and a server reader for `keys.namespace.meta.app`, which is the TODO in `facebookExchange.ts`. Env remains the fallback. The browser still never receives the App Secret. Custody of `keys.namespace` (how the process is given the `_()` secret at start) stays an open decision in [NamespaceNetgetModel](./NamespaceNetgetModel.md), section 11.
- **Then.** The tree entry is the official copy. Env is only an emergency fallback, not the place the App ID is edited day to day.

The `keys.*` reservation gap on an unclaimed root (also in that model's section 11) has to be closed before `keys.namespace.meta.app` in the tree is trusted as the official copy.
