---
layout: gui-doc
title: netget
crumb: netget
description: A Gateway To the Web. Listens on ports 80 and 443 and routes every incoming request.
image: https://suign.github.io/assets/imgs/netget1.png
---

<div class="netget-hero" markdown="0" style="text-align:center;max-width:560px;margin:0 auto 16px;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1780604418/netget_gmdvxy-removebg-preview_eibfyi.png" />
    <img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="280" />
  </picture>
  <p style="margin-top:8px;opacity:.8;">Listens on <strong>ports 80 and 443</strong> and routes every incoming request to the right place — a static folder, a port, or any HTTP service.</p>
</div>

<div class="me-demo-cards" markdown="0">
<a class="card" href="./docs/installing-netget.html"><span class="card-title">⚡ Installing NetGet</span><span class="card-desc">Install the CLI, set up OpenResty, and get local.netget running.</span><code class="card-code">npm i -g netget</code></a>
<a class="card" href="./docs/local-netget.html"><span class="card-title">🖥️ local.netget</span><span class="card-desc">Operator surface — routing, monad mesh, logs, gateway control.</span><code class="card-code">http://local.netget</code></a>
<a class="card" href="./docs/Structure.html"><span class="card-title">🗺️ Domain Routing</span><span class="card-desc">OpenResty, domain-map, and SSL provisioning.</span><code class="card-code">domain-map.json</code></a>
<a class="card" href="./docs/multi-domain-architecture.html"><span class="card-title">🌐 Multi-Domain</span><span class="card-desc">One codebase serving multiple domains with shared sources.</span><code class="card-code">shared/ + domains/</code></a>
<a class="card" href="./docs/whatever-localhost.html"><span class="card-title">🏷️ whatever.localhost</span><span class="card-desc">How &lt;label&gt;.localhost names are routed today.</span><code class="card-code">ana.localhost</code></a>
<a class="card" href="./docs/signed-gateway-capabilities.html"><span class="card-title">🔏 Signed Capabilities</span><span class="card-desc">Per-request .me proofs for gateway control.</span><code class="card-code">identity · proof · capability</code></a>
<a class="card" href="./docs/Digital-Space-Identity-Infographic.html"><span class="card-title">🧬 Digital Space Identity</span><span class="card-desc">Infographic on signed gateway capabilities.</span><code class="card-code">T ⊥ A</code></a>
<a class="card" href="./Typescript/typedocs/"><span class="card-title">📖 TypeDocs</span><span class="card-desc">Full VitePress documentation and API reference.</span><code class="card-code">Typescript/typedocs/</code></a>
<a class="card" href="https://www.npmjs.com/package/netget"><span class="card-title">📦 npm</span><span class="card-desc">Install the global CLI.</span><code class="card-code">npm i -g netget</code></a>
</div>

<style>.me-demo-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:0 0 12px} .me-demo-cards a.card{display:flex;flex-direction:column;gap:6px;padding:14px;border:1px solid rgba(127,127,127,.35);border-radius:12px;text-decoration:none;color:inherit} .me-demo-cards .card-title{font-weight:700} .me-demo-cards .card-desc{font-size:.88rem;opacity:.8} .me-demo-cards .card-code{font-size:.78rem;overflow-x:auto;white-space:nowrap}</style>

<div class="me-intro-head" markdown="1">

## Get started

`netget` is the entry point of a node. Install the global CLI (npm), then run first-time setup.

</div>

<div class="me-intro-grid" markdown="1">

<section class="me-intro" markdown="1">

### Install

```bash
npm i -g netget
```

```bash
netget --version
```

</section>

<section class="me-intro" markdown="1">

### Command line

```bash
netget         # interactive CLI menu
netget init    # first-time setup
netget reload  # reload (or start) the gateway
netget restart # alias for reload
```

</section>

<section class="me-intro wide" markdown="1">

### `netget init`

Run once the first time you set up a gateway on a machine. Safe to re-run; each step is idempotent:

1. **HTTPS cert** — local cert via `mkcert` (skipped if one exists).
2. **Gateway config** — writes/refreshes the OpenResty config from your domain map.
3. **Starts the gateway** — installs `com.netget.openresty` (`launchd` on macOS / `systemd` on Linux). Needs ports 80/443; prompts for `sudo` in the terminal.
4. **Gateway identity claim** — first-run only: establishes your `.me` identity as gateway owner (hash only; credentials are never stored).

When it finishes, start something behind the gateway (otherwise you get 502s):

```bash
npm install -g monad.ai
monads start local
```

</section>

<section class="me-intro wide" markdown="1">

### Domain map

Live routing table; a Lua timer checks it every second. Changes take effect immediately — no restart needed:

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

</section>

<section class="me-intro" markdown="1">

### Runtimes

- 🔷 [TypeScript](./Typescript/) — npm package `netget`
- 🦀 [Rust](./Rust/) — not available yet
- 🐍 [Python](./Python/) — not available yet

</section>

<section class="me-intro" markdown="1">

### Docs

- [Installing NetGet](./docs/installing-netget.html)
- [local.netget](./docs/local-netget.html)
- [Domain Routing Structure](./docs/Structure.html)
- [Multi-Domain Architecture](./docs/multi-domain-architecture.html)
- [whatever.localhost](./docs/whatever-localhost.html)
- [Signed Gateway Capabilities](./docs/signed-gateway-capabilities.html)
- [TypeDocs](./Typescript/typedocs/) · [Architecture](./Typescript/typedocs/Architecture.html)

</section>

</div>

<style>.me-intro-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px} .me-intro{border:1px solid rgba(127,127,127,.35);border-radius:12px;padding:14px;min-width:0} .me-intro.wide{grid-column:1/-1}</style>

---

**MIT** — [neurons.me](https://www.neurons.me) · [GitHub](https://github.com/neurons-me/netget) · [npm](https://www.npmjs.com/package/netget)
