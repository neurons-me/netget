import assert from 'node:assert/strict';
import {
  checkDoorConnection, checkDoorConnections, matchDoorConnection, pathMatchesPrefix,
  parseStoredDoorConnections, serializeDoorConnections, prefixConflictsWithReserved,
} from '../src/runtime/doorConnections.ts';

// The declaration-time rules of a door's connections (src/runtime/doorConnections.ts). The same rules are applied again
// in lua/lib/door_connections.lua when a request arrives (tests/door-connections-lua.test.ts).

const ok = (prefix: string, target = '127.0.0.1:4000', denied: number[] = []) => checkDoorConnection({ prefix, target }, denied);
const refused = (prefix: string, target = '127.0.0.1:4000', denied: number[] = []) => {
  const r = ok(prefix, target, denied);
  assert.equal(r.ok, false, `expected "${prefix}" -> "${target}" to be refused`);
  return (r as { reason: string }).reason;
};

// 1. what FullTrailer needs is accepted, and the target is normalized
for (const prefix of ['/api/fuel', '/api/upload', '/uploads']) {
  const r = ok(prefix);
  assert.ok(r.ok, `${prefix} accepted`);
}
assert.deepEqual((ok('/api/fuel', 'http://localhost:4000') as any).connection, { prefix: '/api/fuel', target: '127.0.0.1:4000' });
assert.deepEqual((ok('/api/fuel', 'LOCALHOST:4000') as any).connection, { prefix: '/api/fuel', target: '127.0.0.1:4000' });

// 2. prefixes: shape
assert.match(refused('api/fuel'), /start with/);
assert.match(refused('/'), /door itself/);
assert.match(refused('/api/fuel/'), /end with/);
assert.match(refused('/api//fuel'), /empty segment/);
assert.match(refused('/api/../v1'), /"\.\."/);
assert.match(refused('/api/./fuel'), /"\."/);
assert.match(refused('/api/fu el'), /letters, digits/);
assert.match(refused('/api/fuel?x=1'), /letters, digits/);
assert.match(refused('/' + 'a'.repeat(200)), /longer than/);

// 3. what the gateway or the monad answer is not carved out, and neither is anything above it
assert.match(refused('/api/v1'), /\/api\/v1/);
assert.match(refused('/api/v1/keychain'), /\/api\/v1/);
assert.match(refused('/api'), /\/api\/v1/, '/api would cover /api/v1: refused');
assert.match(refused('/apps/fulltrailer'), /\/apps/);
assert.match(refused('/claims/signIn'), /\/claims/);
assert.match(refused('/domains'), /\/domains/);
assert.match(refused('/assets/x'), /\/assets/);
assert.equal(prefixConflictsWithReserved('/apiary'), null, '/apiary is not /api');
assert.ok(ok('/apiary').ok, '/apiary is not under or above /api/v1');
assert.ok(ok('/api/fuelcell').ok);

// 4. targets: this delivery accepts a loopback literal and a port that is not the gateway's
assert.match(refused('/api/fuel', '10.0.0.5:4000'), /loopback/);
assert.match(refused('/api/fuel', 'example.com:4000'), /loopback/);
assert.match(refused('/api/fuel', '127.0.0.1'), /loopback/, 'no port');
assert.match(refused('/api/fuel', '127.0.0.1:4000/x'), /loopback/, 'no path in the target');
assert.match(refused('/api/fuel', 'https://127.0.0.1:4000'), /loopback/, 'http only');
assert.match(refused('/api/fuel', 'user@127.0.0.1:4000'), /loopback/, 'no userinfo');
assert.match(refused('/api/fuel', '127.0.0.1:80'), /1024/);
assert.match(refused('/api/fuel', '127.0.0.1:443'), /1024/);
assert.match(refused('/api/fuel', '127.0.0.1:3000'), /gateway/, "netget's backend");
assert.match(refused('/api/fuel', '127.0.0.1:99999'), /1024-65535|loopback/);
assert.match(refused('/api/fuel', '127.0.0.1:8161', [8161]), /registered monad/, 'a registered monad is reached by name');
assert.ok(ok('/api/fuel', '127.0.0.1:8161').ok, 'without the registry, 8161 is just a port: the registry check is the denied list');

// 5. matching: boundaries and the longest prefix
assert.ok(pathMatchesPrefix('/api/fuel', '/api/fuel'));
assert.ok(pathMatchesPrefix('/api/fuel/1', '/api/fuel'));
assert.ok(!pathMatchesPrefix('/api/fuelAnything', '/api/fuel'), '/api/fuelAnything is not /api/fuel');
assert.ok(!pathMatchesPrefix('/api', '/api/fuel'));
assert.ok(!pathMatchesPrefix('/api/fue', '/api/fuel'));
const list = (checkDoorConnections([
  { prefix: '/api/fuel', target: '127.0.0.1:4000' },
  { prefix: '/api/fuel/stats', target: '127.0.0.1:4001' },
  { prefix: '/uploads', target: '127.0.0.1:4000' },
]) as any).connections;
assert.equal(matchDoorConnection('/api/fuel/stats/today', list)?.target, '127.0.0.1:4001', 'longest prefix wins');
assert.equal(matchDoorConnection('/api/fuel/1', list)?.target, '127.0.0.1:4000');
assert.equal(matchDoorConnection('/api/v1/keychain/keys', list), null, 'the monad keeps /api/v1');
assert.equal(matchDoorConnection('/', list), null);

// 6. a list: duplicates, size, shape
assert.equal(checkDoorConnections('nope').ok, false);
const dup = checkDoorConnections([{ prefix: '/a', target: '127.0.0.1:4000' }, { prefix: '/a', target: '127.0.0.1:4001' }]);
assert.equal(dup.ok, false);
assert.match((dup as any).reason, /twice/);
assert.equal(checkDoorConnections(Array.from({ length: 17 }, (_, i) => ({ prefix: `/p${i}`, target: '127.0.0.1:4000' }))).ok, false);
assert.equal(checkDoorConnection(null).ok, false);
assert.equal(checkDoorConnection({ prefix: 5, target: 5 }).ok, false);

// 7. what is stored: a string; an invalid stored value is "no connections", never part of a list
const stored = serializeDoorConnections(list);
assert.equal(parseStoredDoorConnections(stored).length, 3);
assert.deepEqual(parseStoredDoorConnections(undefined), []);
assert.deepEqual(parseStoredDoorConnections('not json'), []);
assert.deepEqual(parseStoredDoorConnections(JSON.stringify([{ prefix: '/api/fuel', target: '127.0.0.1:4000' }, { prefix: '/', target: '127.0.0.1:4000' }])), [], 'one bad entry drops the whole list');
assert.deepEqual(parseStoredDoorConnections(JSON.stringify([{ prefix: '/api/fuel', target: '127.0.0.1:8161' }]), [8161]), [], 'a port that became a registered monad');

console.log('door-connections: ok');
