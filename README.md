<img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;"/>

# netget `2.6.51`

**Physical gateway for the sovereign web.**

`netget` is the entry point of a node. It runs on OpenResty (Nginx + LuaJIT), reads a live domain map, and routes every request to the right place — a static folder, a monad port, or any HTTP service.

```bash
npm install -g netget
netget
```

---

## What netget does

```
this.me    → sovereign kernel. derives identity from (who, secret) seed.
cleaker    → resolver. projects .me into a namespace surface.
monad.ai   → daemon. runs the kernel over HTTP. registers on the mesh.
netget     → gateway. routes physical requests. resolves where execution lives.
```

A namespace is not a port. NetGet keeps them separate:

```
me://suign.cleaker.me/profile/name    ← semantic (permanent, portable)
http://127.0.0.1:8161/profile/name    ← transport (physical, ephemeral)
```

---

## CLI

```bash
netget                     # open the main server panel
netget reload              # reload OpenResty — no need for nginx in PATH
netget restart             # alias for reload
netget generate-domain-map # sync current config → ~/.get/runtime/domain-map.json
netget deploy <user> <pass> --server <url> --targets "['/path/to/project']"
```

---

## Domain map — live routing table

`~/.get/runtime/domain-map.json` is checked every second by a Lua timer. Routing changes take effect immediately — no nginx restart needed:

```json
{
  "domains": {
    "suis-macbook-air.local": { "type": "static", "root": "/Users/suign/.get/html" },
    "frank.cleaker.me":       { "type": "proxy",  "target": "127.0.0.1:8161" },
    "app.neurons.me":         { "type": "server", "target": "127.0.0.1:3000" }
  }
}
```

| Type | Behavior |
|---|---|
| `static` | Serves files from `root`. `index.html` fallback. |
| `proxy` | Forwards to `target` with standard proxy headers. |
| `server` | Same as proxy. Alias for app servers. |

---

## Node landing page

When netget starts for the first time, it deploys `main-server/index.html` to `~/.get/html/`. Visiting `http://hostname.local/` shows the node identity page:

```
node
suis-macbook-air.local
● online
```

The page boots the `all.this` environment if available on the node.

---

## Monad placement

```
netget://iphone/monadlisa     → http://10.0.0.12:8161
netget://raspberry/worker-a  → http://192.168.1.44:42137
netget://vm-prod/api         → https://vm.example.com/_monads/api
```

NetGet resolves *where* a monad physically runs without encoding that location into the semantic address.

---

## Install

```bash
npm install -g netget
```

Requires OpenResty. On macOS:

```bash
brew install openresty/brew/openresty
netget   # handles the rest interactively
```

---

## License

MIT — [neurons.me](https://www.neurons.me)
