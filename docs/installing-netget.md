---
layout: readme
title: Installing NetGet
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

## First run

```bash
netget
```

The interactive CLI walks you through:

1. Initial config — namespace, port, frontend mode
2. Generating the OpenResty nginx config
3. Writing `local.netget → 127.0.0.1` to `/etc/hosts`
4. Starting the NetGet Express server on port `3432`

After setup, open **[http://local.netget](http://local.netget)** in your browser.

---

## Starting NetGet

```bash
netget
# then: NetGetX → Start Server
```

Or use the shorthand once configured:

```bash
netget start
```

NetGet must be running for `local.netget` to respond. OpenResty must also be running:

```bash
sudo openresty          # start
sudo openresty -s reload  # reload config after changes
```

---

## Uninstall

```bash
npm uninstall -g netget
```

Remove the `/etc/hosts` entry and the OpenResty config manually if needed:

```bash
# /etc/hosts — remove the local.netget line
# /opt/homebrew/etc/openresty/conf.d/netget_app.conf — delete file
```

---

## See also

- [local.netget](./local-netget) — the operator dashboard
- [Surface Access Points and Routing](https://neurons-me.github.io/NRP/Surface-Access-Points-and-Routing) — full routing map
- [Architecture](./Architecture) — how NetGet routes requests
