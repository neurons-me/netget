# NetGet Package Surface

`netget` is the gateway CLI/runtime package. It should publish only the files
needed to install, run and configure the local gateway.

## Published Files

- `bin/`: the executable wrapper used by `npx netget`.
- `dist/`: public library exports.
- `src/`: TypeScript runtime and CLI sources while the executable still runs
  through `tsx`.
- `src/modules/NetGetX/OpenResty/lua/`: Lua handlers installed into OpenResty.
- `src/htmls/*.html`: small legacy HTML templates still used by setup flows.
- `assets/main-server-ui/dist/`: the bundled NetGet admin UI.

## Explicitly Not Published

- `main-server/`: legacy prebuilt React UI with large media assets.
- `src/htmls/Netget-REACT/`: old React source/build tree.
- `gui/`: the component-library workspace, published separately as
  `netget.gui`.
- `docs/.vitepress/cache/`: generated docs cache.
- `tests/`: repository validation only.

## Current Compromise

The CLI still runs `src/netget.cli.ts` with `tsx`, so the package must include
selected TypeScript sources for now. The next packaging improvement is to
compile the CLI and its runtime graph into `dist/`, then remove `src/` from the
published package entirely.

## Guardrail

`tests/package-surface.test.ts` checks that the allowlist stays narrow. Always
run `npm pack --dry-run` before publishing; the package should stay small and
must not include old UI trees, nested `node_modules`, media dumps or docs cache.
