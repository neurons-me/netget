# One entry for every door, one document, permissions declared on the parts

The front end used to be two apps chosen by the hostname (`session/providerBoot.js` `frontendRole`): a namespace's own hosts
(cleaker.me, www, a handle) got a bare `Namespace` landing, every other host (netget.site, localhost) got the `<Cleaker>` shell with
netget's document. Same bundle, different sidebar: Monad existed on localhost and not on cleaker.me. A first fix mounted one shell but
still composed TWO documents by door, so an administrator could not reach Domains from the namespace door.

## The rule

> The document declares what the app **offers**; the **selected link** and the permissions it grants decide what a person can **use**.

* `App.jsx` mounts `<Cleaker>` once, with ONE document (`NETGET_DOCUMENT`, `session/entryContext.js`). The address contributes
  **context** only: which namespace the monad or the gateway declared and where it is reached, and how the door presents itself
  (rail icons it leaves out, the node its position label points at). `frontendRole` and its test are unchanged; `local.host` is a
  different surface (HostSurface), not a composition of this app.
* Each part declares what it needs, on the link **and** on the page behind its route:

  | part | `requires` | meaning |
  |---|---|---|
  | Monad, Dashboard, Apps, Terms, Privacy | nothing | public information; the shell dims what needs a layer that is off (`needs`) |
  | Domains | `{ capability: 'gateway:admin' }` | this netget recognizes the identity signed in through the selected link as owner/administrator (a signed `/check-auth`), or a gateway in the list accepts the admin session stored for it |
  | Logs | `{ capability: 'gateway:logs' }` | the **selected** gateway is this netget, and it granted that identity the explicit scope `gateway:control:logs-read` (`lua/handlers/logs.lua` has no owner bypass) |

* The shell (this.gui, `typedocs/Declarative-Requirements.md`) calls one resolver per capability with the **selected link**, the **session
  through it** and an app scope (`session/gatewayCapabilities.js`; the scope is "which gateway is selected, and which admin sessions are
  stored", `gatewayScope`). Fail closed; results belong to (link, identity, scope); a late answer for another key is dropped. The GUI never
  learns what `gateway:admin` means, and the gateway still authorizes every request.
* Why Domains does not follow the selected gateway: the gateway selector lives **inside** that screen. Hiding the screen because the
  selected gateway refuses you would leave no way back (to select this netget, or to paste a session). So Domains is the console
  (offered to whoever administers this netget or holds an accepted session for any listed gateway), and what it may do is decided inside
  it, per selected gateway and its own session, as before. Logs has no selector and does follow the selection.
* Logs now sends the credentials of the **selected gateway** (`utils/gatewayFetch.js`, `session/useGatewayFetch.js`): this netget is asked
  with the signed proof of the identity signed in through the selected link (what nginx's `/logs` asks for); a gateway that was added, with
  its own admin session as a bearer token at its own origin. The shell's identity is never signed for another gateway and one gateway's
  token never goes to another.

## What was verified

* `tests/entry-composition.test.ts`, `tests/gateway-capabilities.test.ts`, `tests/gateway-fetch.test.ts`, `tests/gateway-standing.test.ts` (and, in the GUI,
  `tests/capabilities.test.ts` + `tests/integration/capabilities.browser.test.mjs`: real shell, real Chromium, two links, identity and scope
  changes, late answers).
* Disposable gateway (its own OpenResty, backend and monad), real Chromium, identities registered and signed in through the real forms
  (30 conditions): signed in is not administrator (no Domains/Logs); owner without the logs-read grant gets Domains but not Logs; with the grant,
  both, and Logs sends `X-Me-Proof` and the gateway answers 200; selecting another gateway (no session for it) takes Logs away and keeps Domains,
  selecting this netget brings it back; **an administrator reaches Domains and Logs from the namespace door**; a different identity through the
  same door is not enabled by her grant; recognized-but-not-administrator is still neither; typing `/domains` does not render it.

## Known, not changed here

* A grant given while a page is open is picked up when the key changes (sign in again, or select another gateway / store a session): the shell
  does not poll.
* The Domains screen's write gate (`/add-domain` & co.) accepts an admin SESSION with `gateway:write` (a bearer token), not the shell's signed
  proof. So the permission block now says both facts instead of contradicting the "Unlocked" chip: a row **Esta identidad** (what this netget
  answers to the signed `/check-auth`: owner / administrator / recognized / not recognized; `utils/identityStanding.js`) and, for an
  administrator with no session stored, what is missing to write. Letting the shell's identity mint that session (the existing
  `/admin-session` challenge, signed with the identity's keychain key) is the way to remove the extra step; it is not done here.
* "Conectar la primera puerta" is enabled for a non-administrator on an empty list (the server refuses the write).
* The `url` item (globe) used to show on cleaker.me; it is hidden now, as it already was on the gateway doors.
* Logs for a gateway that was added are not offered: nginx's `/logs` accepts only this machine's own signed proof, not a bearer token.
* `eslint` reports four errors in code that was already there (App.jsx `wrapped` display-name, Logs `_log`, DoorRouter props, gatewayProbe `json`).
