# Test environment

A throwaway place to test apps and data without configuring a server by hand. One call creates it, one call removes it.

```ts
import { createTestEnvironment, withTestEnvironment } from './helpers/testEnvironment.ts';

await withTestEnvironment({ identities: ['alice', 'bob'], seed: { 'profile.motto': 'hello' } }, async (env) => {
  env.namespace;   // env-<random>.test   -- the namespace this environment IS
  env.transport;   // http://127.0.0.1:<port>   -- where it answers (the port is the transport, not the namespace)
  env.identities;  // alice, bob claimed in it, each with its own key: identity.sign(message)
  await env.read('/profile.motto');
});   // process stopped, port closed, storage removed -- also when the callback throws
```

## What it creates
One monad process on its own storage directory (`HOME`, `MONADS_HOME`, `NETGET_DATA_DIR` and the monad's state all under
one temp dir), on a free loopback port, with a random namespace marker. Identities are claimed in it with their own
signing and device keys; `seed` values are written to its own namespace and must read back before it is returned.

## What it guarantees
* **Never the machine's monad.** Variables that could point the child at a real machine (`NETGET_MONAD_ORIGIN`,
  `SEED`, `MONAD_INTERNAL_TOKEN`, …) are removed from its environment; the listener on the port must be a descendant of
  the process this call started, or the call refuses.
* **Closes what it opened, only that.** It kills the process tree it spawned (by the PIDs it recorded) and removes the
  directory it created. `stop()` returns `{ processGone, portClosed, storageRemoved }` and throws if any is false. It is
  also registered for process exit / SIGINT / SIGTERM, so an aborted run does not leave either behind.
* **Two environments do not see each other** (different process, storage, namespace, port).

## What it does not do
* It does not test the gateway: nginx/OpenResty, certificates and the router are `disposableOpenResty.ts` /
  `standaloneBackend.ts`. Use those when the thing under test is the gateway's own behaviour.
* It does not "purge a namespace" from a shared monad: there is no shared store here. The monad keeps a hash-chained log
  and a delete is a tombstone, not a removal; isolation comes from the separate process and storage, and the history
  disappears with the directory.
* Sharing one development monad between several test namespaces is a different decision, to be taken once the name
  isolation of release r20261015-1 (stage 1) is active and keeping history is acceptable.

Tested by `tests/test-environment.test.ts`: creation, identities and data per environment, isolation between two, no
machine ports, closure on success and on a failing callback, closure on an aborted run (SIGTERM, checked separately).
