// A route handler that rejects used to end the whole backend process (Express 4 ignores the returned
// promise; Node then dies on the unhandled rejection). guardAsync turns it into a JSON 500 and the process
// keeps answering.
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
// @ts-ignore -- plain JS module
import { guardAsync, jsonErrorHandler } from '../src/htmls/Netget-REACT/backend/guardAsync.js';

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled += 1; });

const router = express.Router();
router.get('/ok', async (_req, res) => { res.json({ ok: true }); });
router.get('/rejects', async () => { throw Object.assign(new Error('monad is down'), { cause: { code: 'ECONNREFUSED' } }); });
router.get('/throws', () => { throw new Error('sync boom'); });
router.get('/status', async (_req, _res, next) => { next(Object.assign(new Error('nope'), { status: 404 })); });
router.use(async () => { throw new Error('middleware rejects'); });

const app = express();
app.use('/', guardAsync(router));
app.use(jsonErrorHandler);

const server: http.Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const port = (server.address() as any).port;
const get = (path: string): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path }, (res) => {
    let data = ''; res.on('data', (c) => (data += c));
    res.on('end', () => { let body: any = data; try { body = JSON.parse(data); } catch {} resolve({ status: res.statusCode || 0, body }); });
  }).on('error', reject);
});

assert.deepEqual(await get('/ok'), { status: 200, body: { ok: true } });

const rejected = await get('/rejects');
assert.equal(rejected.status, 500);
assert.equal(rejected.body.error, 'INTERNAL_ERROR');
assert.match(rejected.body.detail, /monad is down \(ECONNREFUSED\)/);

const thrown = await get('/throws');
assert.equal(thrown.status, 500);

// an error that carries its own status keeps it
assert.equal((await get('/status')).status, 404);

// the process and the other routes are still alive after the failures
assert.deepEqual(await get('/ok'), { status: 200, body: { ok: true } });
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(unhandled, 0, 'no unhandled rejection reached the process');

server.close();
console.log('✔ guard-async-routes tests passed');
