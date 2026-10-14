// namedSpaceBlock.ts -- the `*.localhost` server block, taken from the generated configuration and put into an INSTALLED
// netget_app.conf without regenerating the rest of it.
//
// Why: the installed file is not what the generator writes for this tree today (it was rendered by an older one and
// carries machine paths), and regenerating it would also change blocks this activation is not about. The named-space block
// is self-contained (its own `server {}`), so the activation adds exactly that block and nothing else, and a reversal is
// the backed-up file. Idempotent: a file that already has the block is returned unchanged.
export const NAMED_SPACE_MARKER = '# ─── Named spaces under localhost';

/** The block (from its marker comment through the closing brace of its `server {}`) in a generated configuration. */
export function extractNamedSpaceBlock(generated: string): string {
  const start = generated.indexOf(NAMED_SPACE_MARKER);
  if (start < 0) throw new Error('the generated configuration has no named-space block');
  const open = generated.indexOf('server {', start);
  if (open < 0) throw new Error('the named-space block has no server {}');
  let depth = 0;
  for (let i = open; i < generated.length; i += 1) {
    const ch = generated[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return generated.slice(start, i + 1) + '\n';
    }
  }
  throw new Error('the named-space block is not closed');
}

/** `installed` with the block appended (top level of the conf.d file, which nginx includes inside `http {}`). */
export function withNamedSpaceBlock(installed: string, generated: string): string {
  if (installed.includes(NAMED_SPACE_MARKER)) return installed;
  const block = extractNamedSpaceBlock(generated);
  return `${installed.replace(/\s*$/, '\n')}\n${block}`;
}
