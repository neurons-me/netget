import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlRootDir } from '../../../../src/utils/netgetPaths.js';

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
  if (force || shouldCopy(SRC_HTML, dest)) {
    fs.copyFileSync(SRC_HTML, dest);
    return { copied: true, dest };
  }
  return { copied: false, dest };
}