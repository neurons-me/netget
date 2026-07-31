# netget · Python 🐍

> **Status: In development**

The Python implementation of `netget` is currently in development.
https://github.com/neurons-me/netget

## Install

```bash
pip install netget
```

---

→ Back to [netget](../)

---

## What is neurons.me?

**[neurons.me](https://neurons.me)** is a sovereign semantic compute stack. It lets any person or machine own a cryptographic identity, bind it to a namespace, run it as an HTTP daemon, and render it as a user interface — without depending on any central service.

| Layer | Package | Role |
|---|---|---|
| **Kernel** | [`this.me`](https://neurons-me.github.io/.me/) | Schema-free reactive memory. Derives identity from a seed. |
| **Identity** | [`cleaker`](https://neurons-me.github.io/Cleaker/) | Namespace resolver. Projects `.me` into a surface. |
| **Runtime** | [`monad`](https://neurons-me.github.io/monad/) | HTTP daemon. Exposes a namespace over HTTP. Runs the mesh. |
| **Gateway** | [`netget`](https://neurons-me.github.io/netget/) | Routes incoming requests to the correct monad. |
| **Interface** | [`this.gui`](https://neurons-me.github.io/GUI/) | React component library. Renders the semantic surface. |

## This package: `netget`

`netget` is the **gateway layer** of the **neurons.me** stack. It sits at the edge of a node — listening on HTTP and HTTPS — and routes requests to whichever monad owns the incoming hostname.

It generates `nginx`/OpenResty configuration from a live routing table. The routing table is checked every second by a Lua timer, so changes take effect immediately without restarting the server.

**monads** register themselves with **netget** via `POST /apps/report`. When a request arrives for `suign.neurons.me`, **netget** looks up the registered monad for that namespace and proxies the request to it.

```bash
npm i -g netget
netget   # starts the gateway, opens CLI
```

**Depends on:** `monad` instances that register themselves for routing.
**Consumed by:** the public internet — all external traffic enters the stack through netget.

---
