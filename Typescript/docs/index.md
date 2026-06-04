# netget

> A Gateway To the Web.

`netget` sits at the edge of a node — listening on HTTP and HTTPS — and routes requests to whichever monad owns the incoming hostname.

---

## Install

```bash
npm install -g netget
netget
```

## Architecture

- Routes hostnames to monads via OpenResty/Nginx
- Live routing table — changes take effect immediately, no restart
- Monads register via `POST /apps/report`

[Architecture →](./Architecture) · [Domain Map →](./DomainMap) · [Placement →](./Placement)
