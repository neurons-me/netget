// monad-http-client-token-boundary.test.ts -- where netget's internal monad token may go (src/kernel/monadHttpClient.ts).
//
// The token reads the gateway's routing records (and writes them). It must reach only a monad on this machine:
//   - a loopback http(s) origin gets it, on reads and writes;
//   - any other origin gets no token at all (the request still goes, without the credential);
//   - a redirect is refused, and the redirect's target receives nothing (fetch keeps custom headers across a
//     cross-origin redirect, so following one would hand the token to wherever the answer pointed).
// Real HTTP servers on this machine; no monad, no gateway.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isTrustedMonadOrigin, readFromMonad, writeToMonad } from '../src/kernel/monadHttpClient.js';
import { INTERNAL_TOKEN_HEADER } from '../src/gateway/internalToken.js';

const TOKEN = 'b'.repeat(64);
process.env.MONAD_INTERNAL_TOKEN = TOKEN;

type Seen = { method: string; url: string; token: string | undefined };
function server(handler?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean, host = '127.0.0.1') {
  const seen: Seen[] = [];
  const s = http.createServer((req, res) => {
    seen.push({ method: String(req.method), url: String(req.url), token: req.headers[INTERNAL_TOKEN_HEADER] as string | undefined });
    req.resume();
    if (handler?.(req, res)) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, value: 'v', memoryHash: 'h' }));
  });
  return new Promise<{ port: number; seen: Seen[]; close: () => Promise<void> }>((resolve) => {
    s.listen(0, host, () => resolve({ port: (s.address() as AddressInfo).port, seen, close: () => new Promise((r) => s.close(() => r())) }));
  });
}

// 1. The rule itself.
for (const o of ['http://127.0.0.1:8161', 'http://localhost:3000', 'http://[::1]:4100', 'https://127.0.0.1']) {
  assert.equal(isTrustedMonadOrigin(o), true, o);
}
for (const o of ['http://10.0.0.5:8161', 'http://cleaker.me', 'https://netget.site', 'http://127.0.0.1.evil.test', 'http://localhost.evil.test',
  'http://[::ffff:127.0.0.1]:1', 'http://user:pass@127.0.0.1:1', 'file:///tmp/x', 'ftp://127.0.0.1', 'not a url', '']) {
  assert.equal(isTrustedMonadOrigin(o), false, o);
}

// 2. Loopback: the token goes, on reads and writes.
{
  const m = await server();
  const origin = `http://127.0.0.1:${m.port}`;
  await readFromMonad(origin, 'netget.example.test', 'domains');
  await writeToMonad(origin, 'netget.example.test', 'domains.x.target', 'http://127.0.0.1:1');
  assert.deepEqual(m.seen.map((s) => s.token), [TOKEN, TOKEN]);
  await m.close();
}

// 3. Not loopback by name (the same machine reached through an IPv4-mapped address): the request goes, the token does not.
{
  const m = await server(undefined, '::');
  const origin = `http://[::ffff:127.0.0.1]:${m.port}`;
  await readFromMonad(origin, 'netget.example.test', 'domains');
  await writeToMonad(origin, 'netget.example.test', 'domains.x.target', 'v');
  assert.equal(m.seen.length, 2);
  assert.deepEqual(m.seen.map((s) => s.token), [undefined, undefined]);
  await m.close();
}

// 4. A redirect is refused; its target receives nothing.
{
  const elsewhere = await server();
  const m = await server((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${elsewhere.port}/stolen` });
    res.end();
    return true;
  });
  const origin = `http://127.0.0.1:${m.port}`;
  await assert.rejects(readFromMonad(origin, 'netget.example.test', 'domains'));
  await assert.rejects(writeToMonad(origin, 'netget.example.test', 'domains.x.target', 'v'));
  assert.equal(m.seen.length, 2);
  assert.equal(elsewhere.seen.length, 0, 'the redirect target was never contacted');
  await m.close();
  await elsewhere.close();
}

console.log('monad-http-client-token-boundary: ok');
