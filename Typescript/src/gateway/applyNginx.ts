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
  const { confPath, luaDir, sourceLuaDir, newConf, backupDir, io } = options;
  const backupConf = path.join(backupDir, path.basename(confPath));
  const backupLua = path.join(backupDir, 'lua');

  const previous = io.read(confPath);
  if (previous !== null) io.write(backupConf, previous);
  io.copyDir(luaDir, backupLua);

  const restore = (): void => {
    if (previous !== null) io.write(confPath, previous);
    io.removeDir(luaDir);
    io.copyDir(backupLua, luaDir);
  };

  try {
    io.copyDir(sourceLuaDir, luaDir);
    io.write(confPath, newConf);
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
