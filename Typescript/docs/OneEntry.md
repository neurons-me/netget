# One entry for every door

The front end used to be two apps chosen by the hostname (`session/providerBoot.js` `frontendRole`): a namespace's own
hosts (cleaker.me, www, a handle) got the bare `Namespace` landing, every other host (netget.site, localhost) got the
`<Cleaker>` shell with netget's document. Same bundle, different sidebar: the Monad item existed on localhost and not on
cleaker.me.

Now `App.jsx` mounts the Cleaker shell once. The address contributes **context**; the document is composed from it
(`session/entryContext.js`, pure, tested in `tests/entry-composition.test.ts`):

| context (resolved) | where it comes from | composes |
|---|---|---|
| `namespace` | the monad that served the page handed it a boot (`__MONAD_NAMESPACE_PROVIDER_BOOT__`) and the host is its namespace | Monad, Terms, Privacy. The link goes to the boot's **root** namespace (never to the address bar, never to a handle's own namespace). Nothing to wait for. |
| `gateway` | any other door: nginx serves the page statically; `/main-server-namespace` says whether this host is the declared main server | Dashboard, Domains, Logs, Apps, Monad, Terms, Privacy. On the main server's own door (netget.site) the Users/Blockchain views are hidden and `/` is the main-server screen. |
| `host` | `local.host` | a different surface (HostSurface), not a composition of this app. Unchanged. |

Rules that did not move: Domains and Logs stay `requires: 'session'` (it hides a link until someone signed in and authorizes
nothing); what a session may do is decided by the server, per request. `frontendRole` and its test are unchanged.

## What was verified (disposable gateway, real monad, real sign-in/registration through the UI)

Doors: gateway (`localhost:<nginx>`), namespace root (`localhost:<door>` with the boot injected), a handle
(`alice.localhost`), and a declared main server (`netget.localhost`).

* No session: gateway and namespace doors show the same rail (users, blockchain, netget, monad).
* Session without gateway grants: the namespace door adds `keychain` and nothing else; the gateway door adds `keychain`, Domains and Logs.
* Administrator (owner, key anchored): the namespace door still has no Domains/Logs, and `/domains`, `/logs` (typed or reached
  inside the app) lead back to the entry. On the gateway door the Domains page shows "Unlocked — <hash>" only once the gateway
  verifies the session (a proof whose key is not anchored there does not); without it the write buttons are disabled and
  Logs is refused by the server.
* Main server door: `/netget` becomes `/`; users/blockchain/url/dashboard hidden; Monad present.

## Known, not changed here

* **Link visibility is by session, not by permission.** On a gateway door any signed-in identity sees the Domains and Logs
  links (the pages and the server then refuse or limit them). Hiding them by permission needs a hook the shell does not
  have: the session lives inside `<Cleaker>` (which mounts its own provider; nothing may sit above it), and `requires` only
  knows `'session'`.
* Logs does not send credentials, and Domains' "what can I modify" block reads an admin-session token, not the shell's
  session: an administrator still sees "Failed to fetch logs" and "Sin sesión para este gateway" there. Both predate this
  change (`utils/adminAccess.js`: "the admin screens are moving to the Cleaker shell").
* On a gateway door with an empty list, "Conectar la primera puerta" is enabled for a non-administrator (its write is refused
  server-side).
* The `url` item (globe) used to show on cleaker.me; it is hidden now, as it already was on the gateway doors.
* Not compared old-vs-new in a browser: sign-in at a handle host.
