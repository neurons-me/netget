import assert from 'node:assert/strict';
import { checkRouteTarget, GATEWAY_PORTS, DESTINATION_KINDS } from '../src/runtime/routeTargets.ts';
import { describeDomain } from '../src/runtime/domainStatus.ts';

const ok = (type: string, target: string, ctx = {}) => { const r = checkRouteTarget(type, target, ctx); assert.ok(r.ok, `${type} ${target}: ${(r as any).reason}`); return r as Extract<ReturnType<typeof checkRouteTarget>, { ok: true }>; };
const no = (type: string, target: string, code: string, ctx = {}) => { const r = checkRouteTarget(type, target, ctx); assert.equal(r.ok, false, `${type} ${target} should be refused`); assert.equal((r as any).code, code, `${type} ${target}: ${(r as any).reason}`); };

// the destination kinds that are supported are declared
assert.deepEqual(DESTINATION_KINDS.map((k) => k.kind).sort(), ['app', 'proxy', 'server', 'static']);

// static: an absolute folder
assert.equal(ok('static', '/Users/yo/sitio/dist').kind, 'static');
assert.equal(ok('static', '/Users/yo/sitio/dist/').target, '/Users/yo/sitio/dist', 'a trailing slash is not part of the folder');
no('static', 'relative/dir', 'STATIC_NOT_ABSOLUTE');
no('static', '/srv/../etc', 'STATIC_PATH');
no('static', '', 'TARGET_REQUIRED');

// server: host:port, on this machine or another one
assert.equal(ok('server', '127.0.0.1:4000').kind, 'server');
assert.equal(ok('server', 'localhost:4000').target, 'localhost:4000');
assert.equal(ok('server', 'http://127.0.0.1:4000').target, '127.0.0.1:4000', 'http:// is normalized away: the router adds it');
assert.equal(ok('server', 'raspberrypi.local:8080').kind, 'server', 'another machine on the network is a destination');
assert.equal(ok('server', '192.168.1.40:3001').kind, 'server');
assert.equal(ok('server', '8181').target, '127.0.0.1:8181', 'a bare port is this machine, as the CLI and the legacy migration have always meant it');
no('server', '3000', 'GATEWAY_PORT');
no('server', '8161', 'REGISTERED_APP_PORT', { registeredPorts: [8161] });
no('server', '70000', 'PORT_RANGE');
no('server', '127.0.0.1', 'TARGET_SHAPE');
no('server', '127.0.0.1:4000/admin', 'TARGET_SHAPE');
no('server', 'user:pw@host:80', 'TARGET_SHAPE');
no('server', 'https://127.0.0.1:4000', 'UPSTREAM_TLS');
no('server', '127.0.0.1:70000', 'PORT_RANGE');
no('server', '127.0.0.1:0', 'PORT_RANGE');
no('server', '', 'TARGET_REQUIRED');

// the protections the other doors have apply to a route too
for (const port of GATEWAY_PORTS) {
  no('server', `127.0.0.1:${port}`, 'GATEWAY_PORT');
  no('server', `localhost:${port}`, 'GATEWAY_PORT');
  assert.equal(ok('server', `rpi.local:${port}`).kind, 'server', 'the same port on ANOTHER machine is not the gateway');
}
no('server', '127.0.0.1:8161', 'REGISTERED_APP_PORT', { registeredPorts: [8161] });
no('server', 'localhost:4100', 'REGISTERED_APP_PORT', { registeredPorts: new Set([4100]) });
assert.equal(ok('server', 'rpi.local:4100', { registeredPorts: [4100] }).kind, 'server', 'a registered port is about THIS machine');
no('server', '169.254.169.254:80', 'LINK_LOCAL');
no('server', '169.254.1.2:8080', 'LINK_LOCAL');

// app:<name>
const app = ok('server', 'app:fulltrailer');
assert.equal(app.kind, 'app');
assert.equal(app.target, 'app:fulltrailer');
assert.equal(ok('proxy', 'app:polls-studio').kind, 'app');
no('server', 'app:', 'APP_NAME');
no('server', 'app:bad name', 'APP_NAME');
no('server', 'app:../x', 'APP_NAME');

// proxy with no target is the monad's semantic surface; anything else is refused
assert.equal(ok('proxy', '').kind, 'proxy');
no('weird', '127.0.0.1:4000', 'TYPE');
no('', '127.0.0.1:4000', 'TYPE');

// ── what a route is doing: states in words, and "unknown" as a state ─────────────────────────────────────────────
const NOW = 1_000_000;
const live = { name: 'monad:demo', lastSeenMs: NOW - 1000, ttlMs: 12000, port: 4100, metadata: { monadName: 'demo' } };
const stale = { name: 'monad:old', lastSeenMs: NOW - 60_000, ttlMs: 12000, port: 4101 };
const cert = { sslCertificate: '/c.pem', sslCertificateKey: '/k.pem' };
const ctx = (extra: any = {}) => ({
  applied: new Set(['a.test', 'b.test', 'c.test', 'd.test']),
  apps: [live, stale],
  now: NOW,
  probeTcp: async (_h: string, p: number) => p === 4000,
  inspectFolder: (p: string) => p === '/srv/site' ? { directory: true, index: true } : p === '/srv/empty' ? { directory: true, index: false } : { directory: false, index: false },
  ...extra,
});
const d = (row: any, extra?: any) => describeDomain({ domain: 'a.test', ...row }, ctx(extra));

let s = await d({ type: 'server', target: '127.0.0.1:4000', ...cert });
assert.equal(s.destination.state, 'ok'); assert.equal(s.tls.state, 'configured'); assert.equal(s.open.url, 'https://a.test/'); assert.equal(s.applied, true);
s = await d({ type: 'server', target: '127.0.0.1:4999', ...cert });
assert.equal(s.destination.state, 'down'); assert.match(s.destination.detail, /no acepta conexiones/);
s = await d({ type: 'static', target: '/srv/site', ...cert });
assert.equal(s.destination.state, 'ok');
s = await d({ type: 'static', target: '/srv/empty', ...cert });
assert.equal(s.destination.state, 'missing'); assert.match(s.destination.detail, /index\.html/);
s = await d({ type: 'static', target: '/srv/nope', ...cert });
assert.equal(s.destination.state, 'missing');
s = await d({ type: 'server', target: 'app:demo', ...cert });
assert.equal(s.destination.state, 'ok');
s = await d({ type: 'server', target: 'app:old', ...cert });
assert.equal(s.destination.state, 'down'); assert.match(s.destination.detail, /no está viva/);
s = await d({ type: 'server', target: 'app:ghost', ...cert });
assert.equal(s.destination.state, 'down'); assert.match(s.destination.detail, /Ninguna app registrada/);

// TLS pending is its own line, and the door has no address that can open yet
s = await d({ type: 'server', target: '127.0.0.1:4000' });
assert.equal(s.tls.state, 'pending'); assert.match(s.tls.detail, /TLS pendiente/); assert.equal(s.open.url, null); assert.equal(s.open.why, 'TLS pendiente');
assert.equal(s.destination.state, 'ok', 'the destination answers; the door is what is not ready');

// unknown is a state: no probes, no registry file, a monad surface, a stored target that is not valid
s = await d({ type: 'server', target: '127.0.0.1:4000', ...cert }, { probeTcp: undefined });
assert.equal(s.destination.state, 'unknown');
s = await d({ type: 'proxy', target: '', ...cert });
assert.equal(s.destination.state, 'unknown');
s = await d({ type: 'server', target: 'https://x:1', ...cert });
assert.equal(s.kind, 'invalid'); assert.equal(s.destination.state, 'unknown');
s = await d({ type: 'server', target: '127.0.0.1:4000', ...cert }, { applied: null });
assert.equal(s.applied, 'unknown', 'no domain-map.json: not "false", unknown');
s = await describeDomain({ domain: 'z.test', type: 'server', target: '127.0.0.1:4000', ...cert }, ctx());
assert.equal(s.applied, false, 'registered but not in the map the router loaded');

console.log('route-targets: ok');
