// gateway-query-canonicalization.test.ts
//
// Shared-vector check for the query-binding fix (see me_sig.lua and
// signedRequest.ts): the client (signedRequest.ts's canonicalizeQuery())
// and the server (lua/lib/query_canon.lua's canonicalize(), the exact
// module me_sig.lua requires) must produce BYTE-IDENTICAL output for the
// same raw query string, because the verifier compares them with plain
// string equality -- never semantic/set equality.
//
// This does not re-implement the Lua side in JS and hope they happen to
// agree: it spins up a disposable OpenResty, mounts a debug-only location
// that requires the REAL lib/query_canon.lua and echoes its output, and
// compares that live response against the local TS re-implementation
// (which must itself match signedRequest.ts's own canonicalizeQuery() --
// gateway-logs-capability.test.ts's local copy is the same function,
// kept in sync by hand like every other test file in this suite).
//
// Found and fixed before this file existed (review, not yet shipped):
// sorting the pairs (an earlier draft of this fix did, by analogy with
// canonicalJson's sorted object keys) silently merges two operationally
// DIFFERENT requests into one canonical form whenever a query key repeats
// -- "?type=access&type=error" and "?type=error&type=access" select
// opposite values under a first-value-wins handler (logs.lua's own
// parse_qs() takes get_uri_args()'s v[1]). Case [1] below proves the
// fix (order preserved, not sorted) distinguishes them; case [2] proves
// the two REAL canonicalizers (TS and the actual Lua module under a real
// nginx request) agree on each one individually.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const openrestyBin = ['/opt/homebrew/bin/openresty', '/usr/local/bin/openresty', '/usr/bin/openresty'].find((p) => fs.existsSync(p));
if (!openrestyBin) { console.log('skipped: no openresty on this machine'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-query-canon-'));
const prefix = path.join(tmp, 'or');
for (const d of ['conf', 'conf.d', 'logs', 'lua']) fs.mkdirSync(path.join(prefix, d), { recursive: true });

const netgetTsRoot = '/Users/suign/Desktop/Neuroverse/all.this/modules/netget/Typescript';
const realLuaDir = path.join(netgetTsRoot, 'src/modules/NetGetX/OpenResty/lua');
fs.mkdirSync(path.join(prefix, 'lua', 'lib'), { recursive: true });
fs.copyFileSync(path.join(realLuaDir, 'lib', 'query_canon.lua'), path.join(prefix, 'lua', 'lib', 'query_canon.lua'));

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); }); });
const HTTP_PORT = await freePort();

const luaPackagePath = `${path.join(prefix, 'lua')}/?.lua;${path.join(prefix, 'lua')}/?/init.lua;/opt/homebrew/opt/openresty/site/lualib/?.lua;/opt/homebrew/opt/openresty/site/lualib/?/init.lua;;`;

// Minimal, self-contained nginx config -- this test needs nothing from the
// real generated netget_app.conf (no monad, no claims, no domains): just
// one debug location that requires the REAL query_canon.lua and echoes its
// output for whatever raw query string the request carries.
const nginxConf = `
worker_processes 1;
pid ${path.join(prefix, 'logs', 'nginx.pid')};
error_log ${path.join(prefix, 'logs', 'error.log')} info;
events { worker_connections 64; }
http {
  lua_package_path '${luaPackagePath}';
  server {
    listen ${HTTP_PORT};
    server_name localhost;
    location = /__test_query_canon {
      content_by_lua_block {
        local cjson = require "cjson.safe"
        local query_canon = require "lib.query_canon"
        local result, err = query_canon.canonicalize(ngx.var.args)
        if err then
          ngx.status = 422
          ngx.header["Content-Type"] = "application/json; charset=utf-8"
          ngx.print(cjson.encode({ error = err }))
          return
        end
        ngx.header["Content-Type"] = "application/json; charset=utf-8"
        ngx.print(result)
      }
    }
  }
}
`;
fs.writeFileSync(path.join(prefix, 'conf', 'nginx.conf'), nginxConf);

let nginx: import('node:child_process').ChildProcess | null = null;
const stopNginx = () => { try { execFileSync(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf'), '-s', 'stop'], { stdio: 'ignore' }); } catch { } nginx?.kill(); nginx = null; };
const startNginx = async () => {
  const t = spawn(openrestyBin, ['-t', '-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')]);
  let out = ''; t.stderr.on('data', (d) => { out += d; }); t.stdout.on('data', (d) => { out += d; });
  assert.equal(await new Promise((r) => t.on('close', r)), 0, `openresty -t failed:\n${out}`);
  nginx = spawn(openrestyBin, ['-p', prefix, '-c', path.join(prefix, 'conf', 'nginx.conf')], { stdio: 'ignore' });
  const listening = (port: number) => new Promise<boolean>((r) => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
  for (let i = 0; i < 50; i += 1) {
    if (await listening(HTTP_PORT)) { await new Promise((r) => setTimeout(r, 100)); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nginx did not start');
};

// The exact function signedRequest.ts's canonicalizeQuery() implements --
// kept here as a local copy (same convention as every other test file in
// this suite), not imported, since signedRequest.ts lives in a separate
// package/repo (packages/GUI/Typescript) this test tree does not depend on.
function canonicalizeQuery(qs: string): string {
  return JSON.stringify(Array.from(new URLSearchParams(qs).entries()));
}

async function luaCanonicalizeFull(rawQuery: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method: 'GET', path: `/__test_query_canon?${rawQuery}`, timeout: 8000 }, (r) => {
      let text = ''; r.setEncoding('utf8'); r.on('data', (c) => { text += c; });
      r.on('end', () => resolve({ status: r.statusCode || 0, text }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Convenience wrapper for the (overwhelming majority of) vectors that are
// expected to succeed -- asserts the 200/canonical-string shape and
// returns just the body, same as before this function was split in two.
async function luaCanonicalize(rawQuery: string): Promise<string> {
  const { status, text } = await luaCanonicalizeFull(rawQuery);
  assert.equal(status, 200, `expected 200 for raw=${JSON.stringify(rawQuery)}, got ${status}: ${text}`);
  return text;
}

let pass = 0; let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ''); }
};

try {
  await startNginx();

  console.log('\n[1] repeated-key order is significant -- the two orderings must NOT canonicalize the same');
  {
    const a = canonicalizeQuery('type=access&type=error');
    const b = canonicalizeQuery('type=error&type=access');
    check('TS: "type=access&type=error" != "type=error&type=access"', a !== b, { a, b });
  }
  {
    const a = await luaCanonicalize('type=access&type=error');
    const b = await luaCanonicalize('type=error&type=access');
    check('Lua: "type=access&type=error" != "type=error&type=access" (the real module, over a real request)', a !== b, { a, b });
  }

  console.log('\n[2] TS and the real Lua module agree, byte-for-byte, on every shared vector');
  const vectors: Array<{ label: string; raw: string }> = [
    { label: 'single ASCII pair', raw: 'type=access' },
    { label: 'repeated key, order A', raw: 'type=access&type=error' },
    { label: 'repeated key, order B (reversed)', raw: 'type=error&type=access' },
    { label: 'repeated key, three values, interleaved with another key', raw: 'a=1&type=access&a=2&type=error&a=3' },
    { label: '"+" decodes to a literal space', raw: 'q=a+b' },
    { label: '"%20" decodes to a literal space (same value as "+", different input bytes)', raw: 'q=a%20b' },
    { label: 'bare key, no "=" at all -> empty value', raw: 'foo' },
    { label: 'key with trailing "=" and nothing after -> empty value', raw: 'foo=' },
    { label: 'bare key and "key=" must canonicalize identically to each other', raw: 'same' },
    { label: 'percent-encoded UTF-8 (café)', raw: 'name=caf%C3%A9' },
    { label: 'percent-encoded UTF-8 (emoji, 4-byte sequence)', raw: 'emoji=%F0%9F%98%80' },
    { label: 'malformed escape: invalid hex digits', raw: 'bad=%zz' },
    { label: 'malformed escape: trailing bare "%"', raw: 'bad=100%' },
    { label: 'malformed escape: lone "%"', raw: 'bad=%' },
    { label: 'multiple distinct keys, non-alphabetical order (order must be preserved, not re-sorted)', raw: 'z=1&a=2&m=3' },
    { label: 'empty query string', raw: '' },
  ];
  for (const v of vectors) {
    const ts = canonicalizeQuery(v.raw);
    const lua = await luaCanonicalize(v.raw);
    check(`${v.label} -- raw=${JSON.stringify(v.raw)}`, ts === lua, { ts, lua });
  }

  console.log('\n[3] "bare key" and "key=" (explicit empty value) canonicalize identically on both sides');
  {
    const tsBare = canonicalizeQuery('same');
    const tsEq = canonicalizeQuery('same=');
    const luaBare = await luaCanonicalize('same');
    const luaEq = await luaCanonicalize('same=');
    check('TS: bare key == key= ', tsBare === tsEq, { tsBare, tsEq });
    check('Lua: bare key == key=', luaBare === luaEq, { luaBare, luaEq });
    check('TS and Lua agree on that shared value', tsBare === luaBare, { tsBare, luaBare });
  }

  // A percent-escape can be individually well-formed ("%FF" IS "%" + two
  // hex digits) while the bytes it decodes to do not form valid UTF-8 --
  // a different failure mode than [2]'s malformed-escape vectors.
  // Confirmed empirically (real divergence, not assumed) before this check
  // existed: URLSearchParams substitutes U+FFFD for each invalid sequence
  // (node -e 'new URLSearchParams("bad=%FF")' -> {bad: "�"}), while
  // cjson.encode passed the raw 0xFF byte straight through -- the two
  // would never byte-match for any request whose query contains invalid
  // UTF-8. Rather than replicate WHATWG's exact replacement algorithm in
  // Lua, the real query_canon.lua now fails closed: both sides must
  // "produce the same, or reject consistently" -- this is the "reject
  // consistently" branch, verified to be an ordinary (422, error-code)
  // response, never an uncaught Lua error / 500.
  console.log('\n[4] invalid UTF-8 (valid escape syntax, invalid decoded bytes) is rejected consistently -- never a 500, never silently compared');
  {
    const invalidUtf8Vectors = [
      { label: 'lone continuation-shaped byte 0xFF (never a valid UTF-8 lead or continuation byte)', raw: 'bad=%FF' },
      { label: '0xC3 lead byte followed by a non-continuation byte', raw: 'bad=%C3%28' },
      { label: 'overlong 2-byte encoding (0xC0 0x80 -- would encode U+0000, which fits in 1 byte)', raw: 'bad=%C0%80' },
      { label: 'UTF-16 surrogate half encoded directly in UTF-8 (0xED 0xA0 0x80 -- disallowed)', raw: 'bad=%ED%A0%80' },
    ];
    for (const v of invalidUtf8Vectors) {
      const { status, text } = await luaCanonicalizeFull(v.raw);
      check(`${v.label} -- raw=${JSON.stringify(v.raw)} -> 422 ME_PROOF_QUERY_INVALID_ENCODING, not a 500`, status === 422 && text.includes('ME_PROOF_QUERY_INVALID_ENCODING'), { status, text });
    }
  }

  console.log('\n[5] valid UTF-8 (including the multi-byte vectors from [2]) is NOT affected by the new check -- still 200, still matches TS');
  {
    const stillValidVectors = ['name=caf%C3%A9', 'emoji=%F0%9F%98%80', 'type=access'];
    for (const raw of stillValidVectors) {
      const ts = canonicalizeQuery(raw);
      const { status, text } = await luaCanonicalizeFull(raw);
      check(`raw=${JSON.stringify(raw)} -- still 200 and still matches TS`, status === 200 && text === ts, { status, text, ts });
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  stopNginx();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('query canonicalization shared-vector probe complete');
