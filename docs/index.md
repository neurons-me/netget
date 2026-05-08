---
layout: home

hero:
  name: "netget"
  text: "Physical gateway for the sovereign web."
  tagline: "Routes domains to monads. Resolves where execution lives. v2.6.51"
  actions:
    - theme: brand
      text: The Gateway
      link: /NetGet
    - theme: alt
      text: API Reference
      link: /api/
---

<div class="vp-doc" style="max-width:960px;margin:0 auto;padding:2rem 1.5rem">

## Install

```bash
npm install -g netget
netget
```

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
netget generate-domain-map # project current config → ~/.get/runtime/domain-map.json
netget deploy <user> <pass> --server <url> --targets "[...]"
```

---

## Domain map — hot-reload routing

Routing is fully dynamic. No nginx reload needed for content changes:

```json
{
  "domains": {
    "suis-macbook-air.local": { "type": "static", "root": "/Users/suign/.get/html" },
    "frank.cleaker.me":       { "type": "proxy",  "target": "127.0.0.1:8161" },
    "app.neurons.me":         { "type": "server", "target": "127.0.0.1:3000" }
  }
}
```

OpenResty checks the file every second via a Lua timer. Adding a domain takes effect immediately.

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
