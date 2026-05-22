---
layout: home

hero:
  name: "netget"
  text: "A Gateway To the Web."
  tagline: " Node.js ⚡ TypeScript Documentation"
  actions:
    - theme: brand
      text: The Gateway
      link: /NetGet
    - theme: alt
      text: API Reference
      link: /api/
---

<div class="vp-doc" style="max-width:960px;margin:0 auto;padding:2rem 1.5rem">
`netget` is the entry point of a node. It **routes every request to the right place** — a static folder, a monad port, or any HTTP service. 

## Install

```bash
npm i -g netget
```

**Start NetGet on your Terminal by running:**

```bash
netget
```

---
# **Build, Expose, Route — Effortlessly.**
## What netget does

NetGet is the physical layer of the neurons.me stack. It runs on OpenResty (Nginx + LuaJIT) and answers one question: *where does this request physically go?*

```
netget://iphone/monadlisa      → http://10.0.0.12:8161
netget://raspberry/worker-a   → http://192.168.1.44:42137
netget://vm-prod/api          → https://vm.example.com/_monads/api
```

Namespace is meaning. Netget is placement. They never mix.

---

## CLI

```bash
netget                     # open the main server panel
netget reload              # reload OpenResty config without knowing the binary path
netget restart             # alias for reload
```

---

## Domain map — hot-reload routing
Routing is fully dynamic. No reload needed for content changes:

```json
{
  "domains": {
    "suis-macbook-air.local": { "type": "static", "root": "/Users/suign/.get/html" },
    "example.com": { "type": "proxy",  "target": "127.0.0.1:8161" },
    "app.neurons.me": { "type": "server", "target": "127.0.0.1:3000" }
  }
}
```

Adding a domain takes effect immediately.

## 🔧 Key Features Version 2.6.x

- Expose your IP securely via HTTPS
- Manage multiple domains and SSL certificates
- Route HTTPS requests to internal services
- Serve static content via HTTPS
- Port management and built-in diagnostics
- Wildcard certificates and subdomain support

---

## Architecture

```
this.me    → sovereign kernel. derives identity from (who, secret) seed.
cleaker    → resolver. projects .me into a namespace surface.
monad.ai   → daemon. runs the kernel over HTTP. registers on the mesh.
netget     → gateway. routes physical requests. resolves monad endpoints.
```

> *The namespace is meaning. The port is transport. NetGet keeps them separate.*

[The Gateway →](./NetGet) · [Monad Placement →](./Placement) · [Architecture →](./Architecture) · [Domain Map →](./DomainMap)

</div>
