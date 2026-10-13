---
layout: readme
title: whatever.localhost
---

# whatever.localhost

`whatever.localhost` stands for any name of the form `<label>.localhost`, such as `ana.localhost`. This page describes what the current NetGet and monad source code does with such a name. It does not describe planned behaviour. Everything below was read from the source; none of it was executed.

Short version: NetGet's OpenResty config has no rule for `*.localhost`. The only code that gives `<label>.localhost` a meaning is monad's namespace normalizer, which maps `<label>.localhost` to `<label>.<local root>`.

---

## 1. Reaching the machine

NetGet does not run a DNS resolver for `.localhost` names. None of the generated configs below contains a `*.localhost` or `.localhost` rule. Any loopback resolution of `<label>.localhost` therefore happens outside NetGet, in the operating system or the browser.

---

## 2. NetGet / OpenResty: which server block answers

| Host | Matched by | Source |
|---|---|---|
| `local.netget`, `local.host`, `local.cleaker`, `<hostname>.netget`, `localhost`, `127.0.0.1` | local panel server block (explicit `server_name`) | `Typescript/src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts:1530` |
| `<handle>.<machine-hostname>` | NRP handle block, regex `~^(?<nrp_handle>[^.]+)\.<machine-hostname>$` → `surface_proxy.lua` | `setNginxConfigRoutes.ts:1462-1471` |
| `whatever.localhost` (any other host) | `default_server` (`server_name _`) | `Typescript/src/modules/NetGetX/OpenResty/setNginxConfigFile.ts:188-240` |

In the default server, a host counts as local only if it is exactly `local.netget`, `localhost` or `127.0.0.1`, or if it matches `%.local$` (`setNginxConfigFile.ts:212-216`). `whatever.localhost` matches none of these, so:

- If no public main domain is set (`_G.MAIN_SERVER_NAME == ""`), NetGet renders the **GatewayStatus** page for that host.
- Otherwise it serves the static panel `index.html`.

The bare name `localhost` is also reserved, so it cannot be added as a routed domain. `RESERVED_LOCAL_DOMAINS = {'local.netget', 'localhost', '127.0.0.1'}` is defined in `Typescript/src/modules/NetGetX/Domains/reservedDomains.ts:1`. That set has no `*.localhost` entry.

---

## 3. monad: `<label>.localhost` as a namespace

The `*.localhost` mapping is in monad, not in NetGet.

- `src/namespace/identity.ts`:
  - `isLoopbackishHost` matches only `localhost`, `127.x` and `0.0.0.0`.
  - `canonicalizeNamespaceConstant` maps those to `resolveLocalNamespaceRoot()`.
  - The root comes from the first of these that is set: `MONAD_LOCAL_ALIAS_ROOT`, `ME_NAMESPACE`, `MONAD_SELF_IDENTITY`, `MONAD_SELF_HOSTNAME`. Otherwise it is the OS hostname (as `<hostname>.local`), and the final fallback is `monad.local`.
- `normalizeNamespaceIdentity("ana.localhost")` returns `ana.<localRoot>`. This is asserted in `tests/observerRelation.test.ts:196-218`. Cleaker's `parseNamespaceExpression` covers the same pattern for `ana.localhost` and `bella.localhost` in `Cleaker/Typescript/tests/namespace-expression.test.ts:30-33`.
- At startup monad logs the convention: `localhost` → local root, `username.localhost` → `username.<root>`, `localhost/@username` (`src/index.ts:79-83`). The default port is `8161` (`src/bootstrap.ts:145`).

### HTTP `Host` header path (current limitation)

`resolveHostNamespace` in `src/http/namespace.ts` handles the `Host` header in four steps:

1. It reads `Forwarded`, `X-Forwarded-Host` or `Host`, then strips `www.`.
2. It calls `resolveHostToMeUri` (`src/runtime/hostResolver.ts`). That calls `projectDnsHostToNamespace` (`.me` `Typescript/src/me-uri.ts:393`), using known spaces taken from `ME_NAMESPACE`, `MONAD_LOCAL_ALIAS_ROOT` and `MONAD_CANONICAL_SPACE`.
3. It checks the host against the configured self aliases (`MONAD_SELF_HOSTNAME`, `MONAD_SELF_ENDPOINT`, `MONAD_SELF_TAGS`).
4. It falls back to `normalizeNamespaceIdentity` **only** when the projection reason is `TRANSPORT_ONLY_HOST`.

`projectDnsHostToNamespace` returns `TRANSPORT_ONLY_HOST` only when the host is exactly `localhost` or ends in `.local` (`me-uri.ts:410`). Going by the source, `whatever.localhost` takes a different path: it does not hit that check, gets `UNKNOWN_SPACE` unless `localhost` is configured as a known space, and so resolves to `"unknown"` in this function. The `<label>.localhost → <label>.<root>` mapping applies when the name is passed to `normalizeNamespaceIdentity` directly, but not through the `Host` header.

---

## Summary

| Name | NetGet (OpenResty) | monad `normalizeNamespaceIdentity` | monad `Host` header |
|---|---|---|---|
| `localhost` | local panel | local root | local root (TRANSPORT_ONLY_HOST) |
| `<name>.local` | default server, treated as local → panel | — | normalized (TRANSPORT_ONLY_HOST) |
| `whatever.localhost` | default server → GatewayStatus or panel | `whatever.<root>` | `"unknown"` unless configured |
