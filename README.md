<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1780604418/netget_gmdvxy-removebg-preview_eibfyi.png" />
  <img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;" />
</picture>

# netget
> **A Gateway To the Web.**

`Netget` listens on ports 80 and 443 and routes every incoming request to the right service.

#### Run on your terminal: (You need [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/))

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

