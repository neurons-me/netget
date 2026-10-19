// Where the workspace's `me` build is, found from this file upwards. The tests that sign with this.me's real Ed25519
// primitives used to import it by a fixed `../../../../me/...`, which is only right when netget sits at
// modules/netget/Typescript; a worktree or a copy at another depth got ERR_MODULE_NOT_FOUND.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function meDistUrl(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    for (const rel of [path.join('me', 'Typescript', 'dist', 'me.es.js'), path.join('all.this', 'me', 'Typescript', 'dist', 'me.es.js')]) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) return pathToFileURL(candidate).href;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('me/Typescript/dist/me.es.js not found above ' + dir);
}
