# Architecture

---

## What each layer owns

| Layer | Owns |
|---|---|
| `.me` | Seed derivation, semantic tree, reactivity, memory |
| `cleaker` | Namespace binding, surface fallback, triad verification |
| `monad.ai` | HTTP surface, kernel exposure, mesh announce/discover |
| `netget` | Physical routing, domain → port mapping, SSL, monad placement |

---

## The node

A node is *a machine running netget.* It is the physical boundary of the stack:

```
hostname.local ← node hostname
  port 80/443 → netget ← entry point
  port 8161 → monad ← suign.cleaker.me kernel
  port 3000 → any service  ← additional processes
  ~/.get/html/ → landing page ← node identity page
```

When you visit `hostname.local`, you reach the node's gateway. NetGet reads `~/.get/runtime/domain-map.json` and routes the request to the correct destination.

---

## Hot-reload architecture

```
~/.get/runtime/domain-map.json    ← written by netget CLI / generate-domain-map
~/.get/runtime/domain-map.version ← bumped on every write

OpenResty Lua timer (1s):
  read version → if changed → reload domain-map → update _G.DOMAIN_MAP

Result: routing changes take effect in under 1 second, no nginx restart needed.
```

---

## NRP integration (2026-05-08)

| Feature | Status |
|---|---|
| Domain → static routing | ✅ |
| Domain → proxy routing | ✅ |
| Hot-reload via Lua timer | ✅ |
| Node landing page (main-server/index.html) | ✅ |
| `netget reload` CLI (no nginx in PATH needed) | ✅ |
| `netget generate-domain-map` | ✅ |
| SSL via Let's Encrypt | ✅ |
| Dynamic SSL per domain (Lua) | ✅ |
| Monad mesh routing (`.mesh/monads`) | 🔲 planned |
| `netget://device/monad` resolution | 🔲 planned |
