// The process a test environment runs: ONE monad on its own storage, on a free loopback port, until SIGTERM.
// Started only by testEnvironment.ts, which sets the environment it reads. Prints one `TESTENV_READY {json}` line when it listens (the monad's own logs share stdout).
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.TEST_ENV_DIR!;
const namespace = process.env.TEST_ENV_NAMESPACE!;
if (!dir || !namespace) throw new Error('TEST_ENV_DIR and TEST_ENV_NAMESPACE are required');
const root = path.join(dir, 'monad');
fs.mkdirSync(root, { recursive: true });
const { createMonadApp } = await import('monad.ai');
const app: any = await createMonadApp({
  cwd: root, seed: `test-environment:${namespace}`, namespace,
  stateDir: path.join(root, 'me-state'), claimDir: path.join(root, 'claims'), selfConfigPath: path.join(root, 'self.json'),
  selfIdentity: namespace, selfHostname: namespace, selfEndpoint: 'http://127.0.0.1:0', selfTags: ['local', 'test-environment'], port: 0,
  guiPkgDistDir: root, mePkgDistDir: root, cleakerPkgDistDir: root, reactUmdDir: root, reactDomUmdDir: root,
  routesPath: path.join(root, 'routes.js'), modules: [], logger: false,
});
const server: import('node:http').Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const port = (server.address() as any).port;
process.stdout.write('TESTENV_READY ' + JSON.stringify({ port, pid: process.pid }) + '\n');
const stop = () => { server.close(); setTimeout(() => process.exit(0), 100).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
setInterval(() => {}, 1 << 30);
