# Domain Map

`~/.get/runtime/domain-map.json` is the live routing table for the node. OpenResty reads it every second via a Lua timer — no nginx reload required for routing changes.

---

## Format

```json
{
  "version": 1,
  "generatedAt": "2026-05-08T00:00:00.000Z",
  "node": {
    "hostname": "Suis-MacBook-Air.local"
  },
  "domains": {
    "suis-macbook-air.local": {
      "type": "static",
      "root": "/Users/suign/.get/html"
    },
    "frank.cleaker.me": {
      "type": "proxy",
      "target": "127.0.0.1:8161"
    },
    "app.neurons.me": {
      "type": "server",
      "target": "127.0.0.1:3000",
      "ssl": {
        "enabled": true,
        "cert": "/etc/ssl/certs/app.neurons.me.crt",
        "key": "/etc/ssl/private/app.neurons.me.key"
      }
    }
  }
}
```

---

## Route types

| Type | Behavior |
|---|---|
| `static` | Serves files from `root` directory. `index.html` fallback. |
| `proxy` | Forwards to `target` (HTTP). Adds standard proxy headers. |
| `server` | Same as proxy. Alias for clarity when target is an app server. |

---

## How to update

```bash
# From the netget CLI — regenerates from current config
netget generate-domain-map

# Or write directly (takes effect within 1 second)
# Edit ~/.get/runtime/domain-map.json
# Bump ~/.get/runtime/domain-map.version (any change to the file content)
```

---

## Version file

`~/.get/runtime/domain-map.version` is a simple sentinel. The Lua timer compares its content on every tick. If it changed, the domain map is reloaded. Write any new value to trigger a reload without restarting nginx.
