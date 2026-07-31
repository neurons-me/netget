---
layout: readme
title: local.netget
---

# local.netget

`local.netget` is the operator surface for the local NetGet gateway. It is the management interface — where you configure routing, inspect the monad mesh, view logs, and control the gateway.

It is not a user-facing surface. It is the surface from which you manage all other surfaces.

---

## What it is

When NetGet is running and OpenResty is configured, `local.netget` resolves to the NetGet Dashboard app. The same address is also reachable as `localhost` and `127.0.0.1`.

| Address | Resolves to |
|---|---|
| `local.netget` | NetGet Dashboard |
| `localhost` | NetGet Dashboard |
| `127.0.0.1` | NetGet Dashboard |

The dashboard is served either from a static build (default) or proxied from a local Vite dev server (dev mode).

---

## What it does

From `local.netget` you can:

- **Gateway Dashboard** — see which monads are registered, their health, and last heartbeat
- **Domains** — add and remove domain → monad routing rules. Changes hot-reload nginx, no restart required
- **Logs** — view the main NetGet server activity log
- **Frontend mode** — switch between serving a static build or proxying a live Vite dev server

---

## How it is served

NetGet reads `~/.get/xConfig.json` to decide how to serve the frontend:

| Mode | What happens |
|---|---|
| `package-dist` | Serves the built UI bundled with the installed netget package |
| `local-dist` | Serves a locally built UI from `~/.get/dist/` |
| `dev` | Proxies all requests to a Vite dev server (default `http://127.0.0.1:5173`) |

To change mode, use the NetGet CLI:

```
netget → NetGetX → Main Server UI → [select mode]
```

Or edit `~/.get/xConfig.json` directly and regenerate the nginx config.

---

## Dev mode

In dev mode, OpenResty proxies `local.netget` directly to the Vite dev server. This means:

- HMR (Hot Module Replacement) works — edits appear instantly in the browser
- The Vite server must be running before you visit `local.netget`
- The nginx config must be regenerated with mode `dev` and reloaded

```bash
# In the frontend_local directory
npm run dev

# Then regenerate and reload nginx via the NetGet CLI
netget → NetGetX → Main Server UI → Use Dev React App
```

---

## The frontend app

The dashboard app that runs at `local.netget` is built with `this.gui`. It lives at:

```
netget/Typescript/src/htmls/Netget-REACT/frontend_local/
```

It connects to the NetGet Express server (default port `3432`) for all API calls — domain management, log streaming, gateway identity, and monad discovery.

---

## Open local.netget

<div style="margin:24px 0;padding:16px 20px;border-radius:10px;border:1px solid #1a2a38;background:#0f1720;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 10px;font-size:0.9rem;color:#98a7b3;">If NetGet is running on this machine, this link opens the dashboard:</p>
  <a href="http://local.netget" target="_blank" style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:6px;background:#162030;border:1px solid #1e3a52;color:#4fc3f7;text-decoration:none;font-size:0.9rem;font-weight:600;">
    🖥️ &nbsp;http://local.netget
  </a>
  <p style="margin:10px 0 0;font-size:0.8rem;color:#4a5a68;">Page doesn't load? → <a href="./installing-netget.html" style="color:#4fc3f7;">Installing NetGet</a></p>
</div>

---

## See also

- [Surface Access Points and Routing](https://neurons-me.github.io/NRP/Surface-Access-Points-and-Routing) — full routing map
- [Architecture](./Architecture) — how NetGet routes requests
- [Domain Map](./DomainMap) — routing table internals
- [Placement](./Placement) — deploying NetGet on a server
