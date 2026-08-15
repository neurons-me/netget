import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlRootDir } from '../../../../src/utils/netgetPaths.js';
import { syncMainServerFrontendToHtmlRoot } from '../OpenResty/mainServerFrontend.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_HTML = path.resolve('src','htmls', 'NetgetErrorCodeHandler.html');

function ensureDir(dir: fs.PathLike) {
  fs.mkdirSync(dir, { recursive: true });
}

function shouldCopy(src: fs.PathLike, dest: fs.PathLike) {
  if (!fs.existsSync(dest)) return true;
  const srcStat = fs.statSync(src);
  const destStat = fs.statSync(dest);
  return srcStat.mtimeMs > destStat.mtimeMs || srcStat.size !== destStat.size;
}

export async function createNetgetHtml({ force = false } = {}) {
  const htmlRoot = getHtmlRootDir();
  ensureDir(htmlRoot);

  const dest = path.join(htmlRoot, 'NetgetErrorCodeHandler.html');
  const result = force || shouldCopy(SRC_HTML, dest)
    ? (fs.copyFileSync(SRC_HTML, dest), { copied: true, dest })
    : { copied: false, dest };

  // Keeps ${xConfig}/html/index.html — netget's own entry point, served
  // directly by nginx.conf's plain-HTTP fallback for local.netget/localhost/
  // 127.0.0.1 — in sync with the active Main Server UI build, independent of
  // whatever any registered domain (or the monad behind it) serves at "/".
  syncMainServerFrontendToHtmlRoot();

  return result;
}