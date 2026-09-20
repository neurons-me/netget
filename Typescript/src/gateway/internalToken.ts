// internalToken.ts -- netget's side of the monad's internal credential (monad.ai's
// http/internalToken.ts). The gateway module runs inside the monad and finds the
// token in the process environment; the netget CLI and anything else on the machine
// finds it in the file the monad keeps next to its state directory (0600, owner-only).
import fs from 'node:fs';
import path from 'node:path';
import { getMonadRuntimeDir, INTERNAL_TOKEN_FILE, INTERNAL_TOKEN_HEADER } from 'monad.ai';
import { getMonadName } from '../kernel/netgetMonadProcess.js';

export { INTERNAL_TOKEN_HEADER };

export function readInternalToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = String(env.MONAD_INTERNAL_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const file = path.join(getMonadRuntimeDir(getMonadName()), INTERNAL_TOKEN_FILE);
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Headers that identify this process as one of the machine's own callers. */
export function internalHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = readInternalToken(env);
  return token ? { [INTERNAL_TOKEN_HEADER]: token } : {};
}
