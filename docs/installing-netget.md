---
layout: gui-doc
title: Installing NetGet
description: Install the netget CLI, run first-time setup with netget init, and reload the OpenResty gateway.
image: https://suign.github.io/assets/imgs/netget1.png
mepath:
  - text: netget
    url: https://neurons-me.github.io/netget/
  - text: docs
    url: https://neurons-me.github.io/netget/docs/
crumb: Installing
---

# Installing NetGet

NetGet runs as a global CLI on your machine. It manages the OpenResty gateway, generates nginx config, and serves the operator dashboard at `local.netget`.

---

## Prerequisites

- **Node.js** ≥ 18
- **OpenResty** (nginx + LuaJIT) — the gateway engine

Install OpenResty on macOS:

```bash
brew install openresty/brew/openresty
```

On Linux, follow the [OpenResty install guide](https://openresty.org/en/linux-packages.html).

---

## Install

```bash
npm install -g netget
```

This installs the `netget` CLI and bundles the operator dashboard frontend.

Verify:

```bash
netget --version
```

---

## First run — `netget init`

```bash
netget init
```

Run this once the first time you set up a gateway on a machine. It is safe to run again later; each step is idempotent and skipped if already done. In order:

1. **HTTPS cert** — generates a local cert via `mkcert` (skipped if one already exists).
2. **Gateway config** — writes/refreshes the OpenResty config from your current domain map.
3. **Starts the gateway** — installs `com.netget.openresty`, a `launchd` service (macOS) or `systemd` unit (Linux) that runs OpenResty and keeps it alive across restarts and reboots. This is *not* `brew services` — netget manages its own service definition directly.
4. **Gateway identity claim** — first-run only: establishes your `.me` identity as the owner of this gateway. Your credentials are never stored, only the resulting hash.

Step 3 needs to bind ports 80 and 443, so **it will prompt for your `sudo` password in the terminal** — that prompt only appears when you run it yourself interactively.

When it finishes, `netget init` tells you the next step, because a gateway with nothing behind it just serves 502s:

```bash
npm install -g monad.ai
monads start local
```

Once a monad is running, open **[http://local.netget](http://local.netget)** in your browser.

---

## Day-to-day commands

```bash
netget         # opens the interactive CLI menu
netget reload  # reload (or start) the gateway
netget restart # alias for reload
```

`netget` with no arguments opens the interactive CLI menu — the day-to-day entry point once a gateway is already set up.

---

## Uninstall

```bash
npm uninstall -g netget
```

Remove the `/etc/hosts` entry and the OpenResty config manually if needed:

```bash
# /etc/hosts — remove the local.netget line
# OpenResty conf.d netget include — delete if present
```

---

## See also

- [local.netget](./local-netget.html) — the operator dashboard
- [Architecture](../Typescript/typedocs/Architecture.html) — how NetGet routes requests
- [Surface Access Points and Routing](https://neurons-me.github.io/NRP/Surface-Access-Points-and-Routing) — full routing map
