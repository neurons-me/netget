# Connect with Facebook

How the "Connect with Facebook" button works, where the namespace's Facebook App ID lives, and what still has to happen before this can be deployed to the VM.

This is the operator and implementer note. The model for `keys.namespace` itself is in [NamespaceNetgetModel](./NamespaceNetgetModel.md) (section 3). The two-key design (the owner signs, the server opens) is in the monad's [Namespace-Keys](../../../monad/Typescript/typedocs/Namespace-Keys.md).

Nothing in this document is a secret. The Meta App Secret is never logged, never written into these docs, and never returned to the browser. The operator types it on the exchange server. Until step 5 it lives only in the server environment, as `META_APP_SECRET`.

## End-to-end flow

1. The person is signed in on the namespace. The identity card loads `useFacebookConnect`. That hook asks the **same origin** for the public App ID: `GET /oauth/facebook/app`. The button is enabled only when that call returns an `appId`. The App Secret is not in the response and is not in the browser module (`facebookConnect.ts`).
2. On click, the browser builds a PKCE challenge (`S256`), stores only the verifier, state, redirect URI, and namespace in `sessionStorage` (key `me.keys.facebook.oauth` — no secret, no token), and opens Facebook's OAuth dialog with the public App ID and the redirect URI.
3. Facebook sends the person back to `{origin}/oauth/callback` (or `{origin}/` if that callback page is not this window). The browser posts the authorization `code`, the redirect URI, and the PKCE verifier to `POST /oauth/facebook/exchange`. The App Secret does not leave the browser, because it is not there.
4. The exchange server loads the public App ID (tree, then env) and the App Secret (env only), talks only to `graph.facebook.com`, exchanges the code for a short-lived token, then for a long-lived token, and returns `{ token, expires }` to the browser. It never returns the App Secret.
5. The browser uses that user token in memory to list Pages and Instagram accounts, then seals the public references under the encrypted keys vault (`keys.meta.facebook.<page>`, `keys.meta.user`, and related Instagram paths). User tokens are not written to `localStorage` or `sessionStorage` in the clear. The user-level `keys.meta.app` fields are not rewritten.

If the App ID cannot be resolved, the button shows "Facebook connect is not available."

## Where each piece lives

### Official path (the model)

`keys.namespace.meta.app` belongs to the namespace (`cleaker.me/keys.namespace`), not to a person's own `.keys`.

- The **public App ID** is stored as is at `keys.namespace.meta.app.id`. netget reads that leaf from the local monad the gateway already talks to (`readFromMonad` via `NETGET_MONAD_ORIGIN` and `getGatewayRootNamespace`). If the tree has no id, it falls back to `META_APP_ID`.
- The **App Secret** stays in `META_APP_SECRET` until step 5. netget does not read `keys.namespace.meta.app.secret` from the tree. Step 5 will store it encrypted to the server's key; see [Namespace-Keys](../../../monad/Typescript/typedocs/Namespace-Keys.md).

### Browser vault (not what the server uses)

The .GUI Keys tree still offers a card for `namespace.meta.app` (`NAMESPACE_META_APP` in `keyVisibility.ts`; the full path under `keys` is `keys.namespace.meta.app`). If the owner types an App ID, App Secret, or redirect there, `saveCustomKeys` seals the fields in the **browser's** encrypted keys vault (`serviceKeyVault.ts`): `localStorage`, PBKDF2 + AES-256-GCM via `localIdentityVault`, a per-service data key, AAD bound to namespace and service.

That save does not reach the server. The connect button does not read it. For the dialog, the browser uses only the public App ID from `GET /oauth/facebook/app`.

There may also be a user-level group, `keys.meta.app`, from earlier saves. Connect no longer depends on it.

After a successful connect, Page and Instagram references are sealed in the same vault under `keys.meta.facebook.<page>` (and related paths). Those are results, not the namespace app credentials.

### Server environment

`META_APP_ID` is the fallback for the public App ID when the tree has none. `META_APP_SECRET` is the only source of the App Secret today. Optional `META_APP_REDIRECT_URIS` may add exact extra redirect URIs, and only if they are `https://cleaker.me/...` or `https://www.cleaker.me/...` (no wildcards, no other hosts).

Errors from the tree reader are not logged, because they may contain secrets. Graph is the only destination that receives the App Secret.

## Why the App Secret must be server-only

The App Secret is a server credential for the Meta app. If it entered the browser module, any script on that origin could read it. The design is therefore:

- the browser does PKCE and holds only the public App ID, the code, and the verifier
- only the exchange server holds the App Secret
- the only network destination that receives the App Secret is `graph.facebook.com`
- a secret typed into the Keys card is sealed for the person in that browser; that is not the same as encrypting it for the server key, and it must not be uploaded to the exchange

## Routes and policy (mounted)

The gateway now mounts:

- `GET /oauth/facebook/app` — returns `{ ok, appId }`. Public: no admin session.
- `POST /oauth/facebook/exchange` — JSON body, only the fields `code`, `redirectUri`, `verifier`; limited to 8kb. Public, but POST-only. A GET is 405.

Both are listed as public in `adminGate.mjs`. A new route would otherwise default to `trusted` (admin session or internal token).

The exchange accepts a redirect URI only if it is on an exact origin+path allowlist. The built-in list is:

- `https://cleaker.me/oauth/callback`
- `https://cleaker.me/`
- `https://www.cleaker.me/oauth/callback`
- `https://www.cleaker.me/`

No wildcards, no other hosts, no query or hash. CORS echoes only those exact origins, never `*`. There is no rate limiter in the gateway today, so none was added.

## Deploy is blocked until `keys.*` is reserved on the VM

Step 1 of [Namespace-Keys](../../../monad/Typescript/typedocs/Namespace-Keys.md) is in monad main (`292dbfaf`): an unclaimed namespace refuses writes to `keys` / `keys.*` (`KEYS_PATH_REQUIRES_CLAIM`); a claimed one needs the owner's signature. That reservation is **not on the VM yet** (the VM still runs monad `r20261108-3`). Until it is, anyone could write a fake public App ID at `keys.namespace.meta.app.id`.

This netget work stays local. It must not be deployed to the VM before that reservation is there.

After the reservation is on the VM, a VM deploy still needs Sui's "sube", and:

1. Sui types `META_APP_SECRET` herself on the exchange server (never in the repo, never logged). `META_APP_ID` is only the fallback if the tree has no public id yet.
2. nginx on `cleaker.me` proxies `/oauth/facebook/*` and `/oauth/callback` to this gateway.
3. The Redirect URI registered in the Meta app matches the allowlist exactly, typically `https://cleaker.me/oauth/callback`.

## Remaining steps

From [Namespace-Keys](../../../monad/Typescript/typedocs/Namespace-Keys.md):

1. **Reserve `keys.*` in the monad** — done in code, not yet on the VM.
2. **netget reads the public App ID and mounts the routes** — this document's step, in netget, local only.
3. **Claim the root `cleaker.me`.** Without a root claim, nobody can sign `keys.namespace.*`. Until then the root's keyring cannot be written, which is the point of step 1.
4. **A server encryption key.** Ed25519 signs; encryption needs X25519, with its public half published so the owner's browser can encrypt to it.
5. **The secret in the tree.** The owner's browser encrypts the App Secret to the server key and writes it signed; netget asks the monad to open it; `META_APP_SECRET` goes away.
