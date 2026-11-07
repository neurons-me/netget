// Live GUI source for this app's dev server (Modules plan, step 0).
//
// `this.gui` is installed here as `file:` to packages/GUI/Typescript, whose package.json `exports` point at its
// built `dist/`. Through that, a GUI change only showed here after a GUI build (or an npm publish). These aliases
// point `this.gui` and every subpath it exports at GUI's SOURCE instead, plus what GUI's own source is written
// against (the same as GUI's vite.config.js): `cleaker` and `this.me` as aliases, and GUI's private `@/...` paths
// through a plugin that resolves them only for files inside GUI. The dev server compiles GUI the way GUI's own Vite
// does, and HMR picks up its edits.
//
// Used only by `npm run dev:gui-source` (THIS_GUI=source): `npm run dev` and `vite build` resolve `this.gui` through
// its package (dist), as any app does, so what a release contains does not change here.
import fs from 'fs';
import path from 'path';

export function thisGuiSourceAliases(allThisRoot) {
  const gui = path.join(allThisRoot, 'packages/GUI/Typescript');
  const src = path.join(gui, 'src');
  const entry = {
    'this.gui/legacy': 'src/legacy/index.tsx',
    'this.gui/runtime': 'src/runtime-entry.ts',
    'this.gui/react': 'src/react-entry.ts',
    'this.gui/devtools': 'src/devtools-entry.ts',
    'this.gui/cleaker': 'src/cleaker-entry.ts',
    'this.gui/style.css': 'public/material-symbols.css',
    'this.gui/style': 'public/material-symbols.css',
    'this.gui/atoms': 'src/gui/Atoms/atoms.ts',
    'this.gui/molecules': 'src/gui/Molecules/molecules.ts',
    'this.gui/compounds': 'src/gui/Compounds/compounds.ts',
    'this.gui/components': 'src/gui/Compounds/compounds.ts',
    'this.gui': 'index.ts',
  };
  const missing = Object.values(entry).filter((rel) => !fs.existsSync(path.join(gui, rel)));
  if (missing.length) throw new Error(`[this.gui source] not found under ${gui}: ${missing.join(', ')}`);

  // Inside GUI, `@/gui/<Folder>` -> its barrel or its folder, exactly as GUI's vite.config.js resolves them.
  const folders = [
    ['Atoms', 'src/gui/Atoms', 'atoms.ts'],
    ['Molecules', 'src/gui/Molecules', 'molecules.ts'],
    ['Compounds', 'src/gui/Compounds', 'compounds.ts'],
    ['Marketplace', 'src/gui/Marketplace', 'marketplace.ts'],
    ['Hooks', 'src/gui-internals/Hooks', 'index.ts'],
    ['Contexts', 'src/gui-internals/Contexts', 'index.ts'],
  ];
  const at = [];
  for (const [name, dir, barrel] of folders) {
    for (const n of [name, name.toLowerCase()]) {
      at.push({ find: new RegExp(`^@/gui/${n}$`), replacement: path.join(gui, dir, barrel) });
      at.push({ find: new RegExp(`^@/gui/${n}/`), replacement: `${path.join(gui, dir)}/` });
    }
  }
  at.push({ find: /^@\/gui\/components$/, replacement: path.join(gui, 'src/gui/Compounds/compounds.ts') });
  at.push({ find: /^@\/gui\/components\//, replacement: `${path.join(gui, 'src/gui/Compounds')}/` });

  // GUI's own source is written against cleaker's source and .me's build (GUI vite.config.js, monorepo aliases).
  const cleaker = path.join(allThisRoot, 'modules/cleaker/Typescript/src/index.ts');
  const me = path.join(allThisRoot, 'me/Typescript/dist/me.es.js');
  const kernel = [
    ...(fs.existsSync(cleaker) ? [{ find: /^cleaker$/, replacement: cleaker }] : []),
    ...(fs.existsSync(me) ? [{ find: /^this\.me$/, replacement: me }] : []),
  ];

  // `@/...` is GUI's own private shorthand: resolved only for files inside GUI, so an `@/` import anywhere else
  // (this app, netget.gui) is never captured by it and fails as it would without this file.
  const atPaths = [...at, { find: /^@\//, replacement: `${src}/` }];
  const insideGui = (importer) => Boolean(importer) && importer.split('?')[0].startsWith(`${gui}/`);
  const plugin = {
    name: 'this-gui-source:at-paths',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.startsWith('@/') || !insideGui(importer)) return null;
      const rule = atPaths.find((r) => r.find.test(source));
      return this.resolve(source.replace(rule.find, rule.replacement), importer, { ...options, skipSelf: true });
    },
  };

  return {
    guiRoot: gui,
    aliases: [
      // Exact ids, longest first: `this.gui/style.css` must not fall to `this.gui`.
      ...Object.entries(entry).map(([id, rel]) => ({ find: new RegExp(`^${id.replace(/\./g, '\\.')}$`), replacement: path.join(gui, rel) })),
      ...kernel,
    ],
    plugin,
    version: JSON.parse(fs.readFileSync(path.join(gui, 'package.json'), 'utf8')).version,
  };
}
