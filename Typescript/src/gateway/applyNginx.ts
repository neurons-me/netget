import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Puts netget_app.conf and the Lua handlers it is generated against in place --
 * as a pair, because the conf names handlers by file and their contents move
 * with it -- without asking anything, and undoes itself if it does not hold:
 *
 *   1. back up the installed conf and Lua directory,
 *   2. write the new ones,
 *   3. validate (openresty -t),
 *   4. only when valid, reload; when not, put the backup back.
 *
 * Nothing else is touched. The filesystem, the validator and the reload are
 * parameters so this can be exercised without a gateway; the defaults use
 * `sudo -n` when a plain write is refused, and never prompt.
 */
export interface ApplyNginxIo {
  read(file: string): string | null;
  write(file: string, content: string): void;
  copyDir(from: string, to: string): void;
  removeDir(dir: string): void;
  validate(): { ok: boolean; output: string };
  reload(): void;
}

export interface ApplyNginxOptions {
  /** The main nginx.conf, changed in the same step when given (its default server routes the doors). */
  mainConf?: { path: string; content: string };
  confPath: string;
  luaDir: string;
  /** The Lua directory shipped with netget, copied over the installed one. */
  sourceLuaDir: string;
  newConf: string;
  backupDir: string;
  io: ApplyNginxIo;
}

export interface ApplyNginxResult {
  ok: boolean;
  reloaded: boolean;
  rolledBack: boolean;
  backupDir: string;
  message: string;
}

export function applyGatewayNginx(options: ApplyNginxOptions): ApplyNginxResult {
  const { confPath, luaDir, sourceLuaDir, newConf, backupDir, io, mainConf } = options;
  const backupConf = path.join(backupDir, path.basename(confPath));
  const backupLua = path.join(backupDir, 'lua');
  const backupMain = mainConf ? path.join(backupDir, `main-${path.basename(mainConf.path)}`) : null;

  const previous = io.read(confPath);
  if (previous !== null) io.write(backupConf, previous);
  const previousMain = mainConf ? io.read(mainConf.path) : null;
  if (mainConf && backupMain && previousMain !== null) io.write(backupMain, previousMain);
  io.copyDir(luaDir, backupLua);

  const restore = (): void => {
    if (previous !== null) io.write(confPath, previous);
    if (mainConf && previousMain !== null) io.write(mainConf.path, previousMain);
    io.removeDir(luaDir);
    io.copyDir(backupLua, luaDir);
  };

  try {
    io.copyDir(sourceLuaDir, luaDir);
    io.write(confPath, newConf);
    if (mainConf) io.write(mainConf.path, mainConf.content);
  } catch (error) {
    restore();
    return { ok: false, reloaded: false, rolledBack: true, backupDir, message: `could not write: ${(error as Error).message}` };
  }

  const validation = io.validate();
  if (!validation.ok) {
    restore();
    return { ok: false, reloaded: false, rolledBack: true, backupDir, message: `validation failed, previous config restored:\n${validation.output}` };
  }

  try {
    io.reload();
  } catch (error) {
    restore();
    try { io.reload(); } catch { /* the restored config is what was already running */ }
    return { ok: false, reloaded: false, rolledBack: true, backupDir, message: `reload failed, previous config restored: ${(error as Error).message}` };
  }
  return { ok: true, reloaded: true, rolledBack: false, backupDir, message: 'applied and reloaded' };
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

function sudo(args: string[], input?: string): void {
  execFileSync('sudo', ['-n', ...args], { input, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Real filesystem + OpenResty, using `sudo -n` when a write is refused. */
export function systemIo(bin: string, configFilePath: string): ApplyNginxIo {
  return {
    read(file) {
      try { return fs.readFileSync(file, 'utf8'); } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        if (!isPermissionError(error)) throw error;
        try { return execFileSync('sudo', ['-n', 'cat', file], { encoding: 'utf8' }); } catch { return null; }
      }
    },
    write(file, content) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
      } catch (error) {
        if (!isPermissionError(error)) throw error;
        sudo(['mkdir', '-p', path.dirname(file)]);
        sudo(['tee', file], content);
      }
    },
    copyDir(from, to) {
      try {
        fs.mkdirSync(to, { recursive: true });
        fs.cpSync(from, to, { recursive: true, force: true });
      } catch (error) {
        if (!isPermissionError(error)) throw error;
        sudo(['mkdir', '-p', to]);
        sudo(['cp', '-a', `${from}/.`, `${to}/`]);
      }
    },
    removeDir(dir) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {
        if (!isPermissionError(error)) throw error;
        sudo(['rm', '-rf', dir]);
      }
    },
    validate() {
      try {
        const output = execFileSync('sudo', ['-n', bin, '-t', '-c', configFilePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, output };
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string; message?: string };
        const output = `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message || '';
        // `nginx -t` reports success on stderr with a non-zero exit only when it fails.
        return { ok: /test is successful/.test(output) && !/\[emerg\]/.test(output), output };
      }
    },
    reload() {
      sudo([bin, '-c', configFilePath, '-s', 'reload']);
    },
  };
}

// ── what applying would change, without changing it ────────────────────────

/** Line diff (LCS) as "-old" / "+new" lines with a little context; empty when identical. */
export function lineDiff(before: string, after: string, context = 2): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length; const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: Array<{ t: ' ' | '-' | '+'; line: string }> = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', line: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { ops.push({ t: '-', line: a[i] }); i += 1; }
    else { ops.push({ t: '+', line: b[j] }); j += 1; }
  }
  while (i < n) { ops.push({ t: '-', line: a[i] }); i += 1; }
  while (j < m) { ops.push({ t: '+', line: b[j] }); j += 1; }
  const keep = new Set<number>();
  ops.forEach((op, index) => {
    if (op.t === ' ') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) keep.add(k);
  });
  const out: string[] = [];
  let last = -2;
  ops.forEach((op, index) => {
    if (!keep.has(index)) return;
    if (index !== last + 1) out.push('@@');
    out.push(`${op.t}${op.line}`);
    last = index;
  });
  return out;
}

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

export interface DiffNginxOptions {
  io: Pick<ApplyNginxIo, 'read'>;
  confPath: string;
  newConf: string;
  mainConf?: { path: string; content: string };
  luaDir: string;
  sourceLuaDir: string;
}

/** What --apply-nginx would change: per file, how many lines and which; nothing is written. */
export function diffGatewayNginx(options: DiffNginxOptions): string {
  const { io, confPath, newConf, mainConf, luaDir, sourceLuaDir } = options;
  const lines: string[] = [];
  const report = (label: string, installed: string | null, generated: string) => {
    if (installed === null) { lines.push(`# ${label}: not installed yet (${generated.split('\n').length} lines would be written)`); return; }
    const changes = lineDiff(installed, generated);
    const removed = changes.filter((l) => l.startsWith('-')).length;
    const added = changes.filter((l) => l.startsWith('+')).length;
    lines.push(`# ${label}: ${changes.length === 0 ? 'identical' : `${removed} lines removed, ${added} added`}`);
    lines.push(...changes);
  };
  report(confPath, io.read(confPath), newConf);
  if (mainConf) report(mainConf.path, io.read(mainConf.path), mainConf.content);
  else lines.push('# main nginx.conf: not included (add --apply-main-conf)');
  const changed: string[] = [];
  for (const rel of walk(sourceLuaDir)) {
    const generated = fs.readFileSync(path.join(sourceLuaDir, rel), 'utf8');
    const installed = io.read(path.join(luaDir, rel));
    if (installed === null) changed.push(`+ ${rel} (new)`);
    else if (installed !== generated) changed.push(`~ ${rel}`);
  }
  lines.push(`# lua: ${changed.length === 0 ? 'identical' : `${changed.length} files differ`}`);
  lines.push(...changed);
  return lines.join('\n');
}
