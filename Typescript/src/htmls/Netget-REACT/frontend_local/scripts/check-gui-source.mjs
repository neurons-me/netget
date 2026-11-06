#!/usr/bin/env node
// Checks this app's dev server against this.gui, in both modes (thisGuiSource.js):
//   source  `vite` (default): this.gui compiled from packages/GUI/Typescript's source, edits live
//   dist    `THIS_GUI=dist vite`: this.gui through its package (GUI's built dist/, what `vite build` uses)
//
// What it checks, per mode, through two doors of the same shell (App.jsx): 127.0.0.1 and local.cleaker:
// - where this.gui came from (source modules vs dist files)
// - one copy each of React, React Router, MUI and Emotion in what the dev server bundled
// - every route loads directly (= a reload), with no page error
// - client-side navigation and Back: the URL changes, the page is not reloaded, no error
// - source mode only: a GUI source edit reaches the open page with no GUI build
//
// It never reaches a real service: the dev server's API proxy points at a dead port (NETGET_BACKEND), local.cleaker
// is mapped to 127.0.0.1 inside this browser only, and the browser aborts every request that is not to the dev
// server itself (counted at the end). The GUI file edited for the live check is restored in a `finally`.
//
// Needs Playwright with Chromium; it is taken from packages/GUI/Typescript (a dev dependency there). Run:
//   npm run check:gui-source              (both modes)
//   npm run check:gui-source -- source    (one mode)
// Exit code 1 if anything FAILs. KNOWN lines are real, already-understood gaps (see README), not failures.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ALL_THIS overrides it for a checkout of netget outside all.this (a worktree elsewhere).
const ALL_THIS = process.env.ALL_THIS ? path.resolve(process.env.ALL_THIS) : path.resolve(APP, '../../../../../../../');
const GUI = path.join(ALL_THIS, 'packages/GUI/Typescript');
const { chromium } = createRequire(path.join(GUI, 'package.json'))('playwright');
const PORT = Number(process.env.CHECK_PORT || 5199);
const DEAD_BACKEND = 'http://127.0.0.1:9';
const MARK_FILE = path.join(GUI, 'src/runtime/addressAxis.ts');
const SHARED = ['react', 'react-dom', 'react-router', 'react-router-dom', '@mui/material', '@mui/system', '@emotion/react', '@emotion/styled', '@emotion/cache'];

// Every door renders the same shell (App.jsx); two doors are checked so both entry paths are covered.
const SHELL_ROUTES = ['/', '/.me', '/users', '/blockchain', '/netget', '/monad', '/terms-and-conditions', '/privacy-policy', '/GUI', '/GUI/themes', '/GUI/themes/typography', '/GUI/layout'];
const SURFACES = [
  {
    name: 'gateway door',
    origin: `http://127.0.0.1:${PORT}`,
    routes: SHELL_ROUTES,
    // The dev server's API proxy also owns these paths (vite.config.js), so loading them directly there asks the
    // backend, not the app (nginx serves the app for them). Their links appear only while the backend answers, and
    // this check runs with none, so they are not covered here.
    proxiedInDev: ['/domains', '/logs'],
    // Users and Monad are offered but disabled while no monad answers (reported, not clicked).
    navigation: [{ from: '/', to: '/.me' }, { from: '/GUI', to: '/GUI/layout' }, { from: '/', to: '/users' }, { from: '/', to: '/monad' }],
  },
  {
    name: 'namespace door',
    origin: `http://local.cleaker:${PORT}`,
    routes: SHELL_ROUTES,
    proxiedInDev: [],
    navigation: [
      { from: '/GUI', to: '/GUI/layout' },
      { from: '/GUI', to: '/GUI/themes' },
      // The inspector's tabs navigate on click; they are tabs, not links.
      { from: '/GUI/themes', to: '/GUI/themes/typography', tab: /typography/i },
    ],
  },
];

const modes = process.argv.slice(2).filter((a) => a === 'source' || a === 'dist');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const report = (status, name, info = '') => {
  if (status === 'FAIL') failed += 1;
  console.log(`${status} ${name}${info ? ` — ${info}` : ''}`);
};
const verdict = (pass) => (pass ? 'PASS' : 'FAIL');

async function checkMode(mode) {
  console.log(`\n== ${mode} ==`);
  const env = { ...process.env, BROWSER: 'none', NETGET_BACKEND: DEAD_BACKEND };
  if (mode === 'dist') env.THIS_GUI = 'dist';
  else delete env.THIS_GUI;
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--force'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  vite.stdout.on('data', (d) => (log += d));
  vite.stderr.on('data', (d) => (log += d));
  const original = fs.readFileSync(MARK_FILE, 'utf8');
  let browser;
  try {
    for (let i = 0; i < 80 && !log.includes('Local:'); i++) await wait(500);
    if (!log.includes('Local:')) throw new Error(`dev server did not start:\n${log}`);
    report(verdict(log.includes('[this.gui] source:') === (mode === 'source')), 'dev server mode', mode);

    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP local.cleaker 127.0.0.1`] });
    const urls = [];
    const outside = [];
    for (const surface of SURFACES) {
      console.log(`  -- ${surface.name} (${surface.origin})`);
      const page = await browser.newPage();
      let errors = [];
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(surface.origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        outside.push(`${route.request().method()} ${u}`);
        return route.abort();
      });
      page.on('request', (r) => urls.push(r.url()));
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        // Refused calls are expected (dead backend, aborted outside requests); anything else is a real error.
        if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ECONNREFUSED|net::|status of 50\d|Failed to fetch/.test(m.text())) errors.push(m.text());
      });
      const settle = async () => { await page.waitForLoadState('load'); await wait(1500); };
      const main = async () => (await page.evaluate(() => (document.querySelector('main') ?? document.body).innerText)).replace(/\s+/g, ' ').trim();

      for (const route of surface.routes) {
        errors = [];
        const response = await page.goto(`${surface.origin}${route}`);
        await settle();
        const status = response?.status() ?? 0;
        if (status >= 400 || status === 0) { report('FAIL', `direct ${route}`, `HTTP ${status}: ${(await main()).slice(0, 80)}`); continue; }
        const shown = await main();
        const at = await page.evaluate(() => location.pathname);
        report(verdict(shown.length > 0 && at === route && errors.length === 0), `direct ${route}`,
          errors.length ? errors.slice(0, 2).join(' | ') : at !== route ? `ended at ${at}` : JSON.stringify(shown.slice(0, 60)));
      }
      for (const route of surface.proxiedInDev) report('KNOWN', `${route} not covered`, 'the dev server proxies it to the API, and its link needs a backend that answers');

      for (const { from, to, tab } of surface.navigation) {
        errors = [];
        await page.goto(`${surface.origin}${from}`);
        await settle();
        const link = tab ? page.getByRole('tab', { name: tab }).first() : page.locator(`a[href="${to}"]`).first();
        if ((await link.count()) && (await link.getAttribute('aria-disabled')) === 'true') {
          report('KNOWN', `navigate ${from} -> ${to} -> Back`, `the link is offered disabled: its page needs a layer this check runs without`);
          continue;
        }
        if (!(await link.count())) {
          report(mode === 'dist' ? 'KNOWN' : 'FAIL', `navigate ${from} -> ${to} -> Back`, `no link to ${to} on ${from}${mode === 'dist' ? ' in this dist' : ''}`);
          continue;
        }
        await page.evaluate(() => { window.__navMark = 'kept'; });
        try { await link.click({ timeout: 5000 }); } catch (e) { report('FAIL', `navigate ${from} -> ${to} -> Back`, String(e).split('\n')[0]); continue; }
        await page.waitForFunction((p) => location.pathname === p, to, { timeout: 5000 }).catch(() => {});
        await wait(1000);
        const after = await page.evaluate(() => [location.pathname, window.__navMark]);
        const afterText = await main();
        await page.goBack();
        await page.waitForFunction((p) => location.pathname === p, from, { timeout: 5000 }).catch(() => {});
        await wait(1000);
        const back = await page.evaluate(() => [location.pathname, window.__navMark]);
        const pass = after[0] === to && after[1] === 'kept' && afterText.length > 0 && back[0] === from && back[1] === 'kept' && errors.length === 0;
        report(verdict(pass), `navigate ${from} -> ${to} -> Back`,
          errors.length ? errors.slice(0, 2).join(' | ')
            : `went to ${after[0]}${after[1] ? '' : ' (reloaded)'}${afterText ? '' : ' (empty)'}, back to ${back[0]}${back[1] ? '' : ' (reloaded)'}`);
      }

      // Source mode: an edit to GUI's source reaches the open page with no GUI build.
      if (mode === 'source' && surface.name === 'namespace door') {
        await page.goto(`${surface.origin}/GUI`);
        await settle();
        const mark = `live-${Date.now()}`;
        fs.writeFileSync(MARK_FILE, `${original}\n;(globalThis as any).__guiLiveMark = '${mark}';\n`);
        let seen;
        for (let i = 0; i < 30 && seen !== mark; i++) {
          await wait(500);
          seen = await page.evaluate(() => globalThis.__guiLiveMark).catch(() => undefined);
        }
        fs.writeFileSync(MARK_FILE, original);
        report(verdict(seen === mark), 'a GUI source edit reaches the open page (no GUI build)', seen === mark ? '' : `saw ${seen}`);
      }
      await page.close();
    }

    // Where this.gui came from, and one copy of each shared dependency.
    const fromSource = urls.filter((u) => u.includes('/packages/GUI/Typescript/src/') || u.includes('/packages/GUI/Typescript/index.ts')).length;
    const fromDist = urls.filter((u) => u.includes('/packages/GUI/Typescript/dist/')).length;
    report(verdict(mode === 'source' ? fromSource > 0 && fromDist === 0 : fromDist > 0 && fromSource === 0), 'this.gui origin', `${fromSource} source modules, ${fromDist} dist files`);
    const depsDir = path.join(APP, 'node_modules/.vite/deps');
    const roots = {};
    for (const f of fs.readdirSync(depsDir).filter((f) => f.endsWith('.js'))) {
      for (const m of fs.readFileSync(path.join(depsDir, f), 'utf8').matchAll(/^\/\/ (\S*node_modules\/(@[a-z-]+\/[a-z-]+|[a-z-]+))\//gm)) {
        if (SHARED.includes(m[2])) (roots[m[2]] ??= new Set()).add(path.resolve(APP, m[1]));
      }
    }
    const multi = Object.entries(roots).filter(([, s]) => s.size > 1);
    const core = multi.filter(([k]) => !['@mui/system', '@emotion/cache'].includes(k));
    const fromGuiModules = urls.filter((u) => /packages\/GUI\/Typescript\/node_modules\/(react|react-dom|react-router|react-router-dom|@mui|@emotion)\//.test(u));
    const describe = (list) => list.map(([k, s]) => `${k}: ${[...s].map((r) => path.relative(ALL_THIS, r)).join(' + ')}`).join('; ');
    if (mode === 'dist' && multi.length && !core.length && !fromGuiModules.length) {
      // GUI's dist imports @mui/system from GUI's own install (it is external there), and @emotion/cache is reached
      // from two installs. Only source mode pins them (vite.config.js); the build is left as it was (README).
      report('KNOWN', 'one copy each of React, Router, MUI, Emotion', `dist duplicates ${describe(multi)}`);
    } else {
      report(verdict(multi.length === 0 && fromGuiModules.length === 0), 'one copy each of React, Router, MUI, Emotion',
        multi.length ? describe(multi) : fromGuiModules.length ? fromGuiModules[0] : `${Object.keys(roots).length} packages, one root each`);
    }

    console.log(`     requests outside the dev server, aborted by the browser (never sent): ${outside.length}`);
    const refused = (log.match(/http proxy error/g) || []).length;
    console.log(`     API calls proxied to the dead backend ${DEAD_BACKEND} (refused): ${refused}`);
  } finally {
    if (fs.readFileSync(MARK_FILE, 'utf8') !== original) fs.writeFileSync(MARK_FILE, original);
    await browser?.close();
    vite.kill('SIGTERM');
    for (let i = 0; i < 20 && vite.exitCode === null; i++) await wait(200);
    if (vite.exitCode === null) vite.kill('SIGKILL');
  }
}

for (const mode of modes.length ? modes : ['source', 'dist']) await checkMode(mode);
console.log(failed ? `\n${failed} failed` : '\nno failures');
process.exit(failed ? 1 : 0);
