# Monad Exposure Through NetGet

NetGet is the network boundary for monads. A monad should run as an internal service, usually on `127.0.0.1:<port>`, and report itself to NetGet's local app registry.

The default exposure policy is deny-by-default for anything beyond loopback:

- visibility defaults to `loopback`
- LAN and WAN are disabled
- control and destructive actions require session auth
- HTTP is allowed locally; HTTPS/WAN require explicit policy

NetGet distinguishes three layers:

- declared policy: what an app or monad reports
- effective policy: what NetGet resolves after defaults, overrides, and runtime constraints
- gateway enforcement: what OpenResty/Lua allows for the current request

Current build guards:

```bash
npm test
```

The tests cover policy merging/runtime constraints and the generated `/monads/:name/*` proxy config. They do not start OpenResty or bind port 80.
