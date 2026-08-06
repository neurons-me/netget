<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1780604418/netget_gmdvxy-removebg-preview_eibfyi.png" />
  <img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;" />
</picture>

# netget `2.7.6`
`netget` is the entry point of a node. It **routes every request to the right place** — a static folder, a port, or any HTTP service. 

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
netget       # opens the interactive CLI menu
netget init  # first-time setup — see below
netget reload  # reload (or start) the gateway
netget restart # alias for reload
```

**`netget`** with no arguments opens the interactive CLI menu — the
day-to-day entry point once a gateway is already set up.

**`netget init`** — run this once, the first time you set up a gateway
on a machine. It's safe to run again later; each step is idempotent and
skipped if already done. In order:

1. **HTTPS cert** — generates a local cert via `mkcert` (skipped if one already exists).
2. **Gateway config** — writes/refreshes the OpenResty config from your current domain map.
3. **Starts the gateway** — installs `com.netget.openresty`, a `launchd` service (macOS) or `systemd` unit (Linux) that runs OpenResty and keeps it alive across restarts and reboots. This is *not* `brew services` — netget manages its own service definition directly, so OpenResty comes back up on its own if it ever crashes.
4. **Gateway identity claim** — first-run only: establishes your `.me` identity as the owner of this gateway. Your credentials are never stored, only the resulting hash.

Step 3 needs to bind ports 80 and 443, so **it will prompt for your
`sudo` password in the terminal** — that prompt only appears when you
run it yourself interactively; there is no way around it, by design.

When it finishes, `netget init` tells you the next step, because a
gateway with nothing behind it just serves 502s:

```bash
npm install -g monad.ai
monads start local
```

Once a monad is running, refresh the browser — the gateway now has
something to route to.

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

