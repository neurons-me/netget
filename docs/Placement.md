# Monad Placement

A namespace is not a port. NetGet resolves *where* a monad physically runs without encoding that location into the semantic address.

---

## The separation

```
me://suign.cleaker.me/profile/name    ← semantic address (permanent, portable)
http://127.0.0.1:8161/profile/name    ← transport address (physical, ephemeral)
```

The namespace `suign.cleaker.me` is the same regardless of which machine the monad runs on. NetGet maps the current physical endpoint to that namespace at routing time.

---

## Placement resolution

```
user intent: read jabellae.cleaker.me/photos/iphone
NRP:         choose the best monad route internally
NetGet:      resolve that monad route to a current endpoint
```

```
netget://iphone/monadlisa     → http://10.0.0.12:8161
netget://raspberry/worker-a  → http://192.168.1.44:42137
netget://vm-prod/api         → https://vm.example.com/_monads/api
```

---

## Domain map routing types

```json
{ "type": "static", "root": "/path/to/static/files" }
{ "type": "proxy",  "target": "127.0.0.1:8161" }
{ "type": "server", "target": "127.0.0.1:3000" }
```

- **static** — serves files directly from a directory
- **proxy / server** — forwards requests to a running process (monad or any HTTP service)

---

## Debug routing

When an operator needs to override which monad handles a path:

```
me://jabellae.cleaker.me[monadlisa]/photos/iphone
```

The `[monadlisa]` selector targets a specific monad by name. It changes execution only — the namespace and path meaning are unchanged. NetGet resolves `monadlisa`'s current endpoint and forwards the request there.
