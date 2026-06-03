<img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;"/>

# netget
> **A Gateway To the Web.**

`netget` is the **entry point of a node** in the neurons.me stack. It listens on ports 80 and 443, routes every incoming request to the right monad or static service, and generates OpenResty/Nginx configuration automatically — no manual config, no restarts.

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

`netget` is the **gateway layer** of the neurons.me stack. It sits at the edge of a node — listening on HTTP and HTTPS — and routes requests to whichever monad owns the incoming hostname.

It generates `nginx`/OpenResty configuration from a live routing table. The routing table is checked every second by a Lua timer, so changes take effect immediately without restarting the server.

Monads register themselves with netget via `POST /apps/report`. When a request arrives for `suign.neurons.me`, netget looks up the registered monad for that namespace and proxies the request to it.

```bash
npm i -g netget
netget   # starts the gateway, opens CLI
```

**Depends on:** `monad` instances that register themselves for routing.
**Consumed by:** the public internet — all external traffic enters the stack through netget.

---

#### Run on your terminal: (You need npm)

```bash
npm i -g netget
```

#### **Start netget on your terminal by running:**

```bash
netget
```

#### Command Line:

```bash
netget # opens CLI
netget reload  # reloads server 
netget restart # alias for reload
```

---

# Configuring network routes and exposing services:
Domain map — live routing table is checked every second by a **Lua** timer. 

Routing changes take effect immediately — *no restart needed:*

```json
{
  "domains": {
    "suis-macbook-air.local": { "type": "static", "root": "/Users/suign/.get/html" },
    "other-service.local": { "type": "proxy",  "target": "127.0.0.1:8161" }
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
When netget starts for the first time, visiting `http://hostname.local/` shows the node identity page:

```bash
node
hostname.local
● online
```

The page boots the `all.this` environment if available on the node. Which means this host is now listenning on HTTP and HTTPS requests. Port 80 and 443. Which is the **world wide web.**

---

## License

**MIT** — [neurons.me](https://www.neurons.me)

