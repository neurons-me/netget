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
import { startTestBackend, DOMAIN_ROW, LOG_LINE } from './testBackend.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ALL_THIS overrides it for a checkout of netget outside all.this (a worktree elsewhere).
const ALL_THIS = process.env.ALL_THIS ? path.resolve(process.env.ALL_THIS) : path.resolve(APP, '../../../../../../../');
const GUI = path.join(ALL_THIS, 'packages/GUI/Typescript');
const { chromium } = createRequire(path.join(GUI, 'package.json'))('playwright');
const PORT = Number(process.env.CHECK_PORT || 5199);
const DEAD_BACKEND = 'http://127.0.0.1:9';
const MARK_FILE = path.join(GUI, 'src/runtime/addressAxis.ts');
const SHARED = ['react', 'react-dom', 'react-router', 'react-router-dom', '@mui/material', '@mui/system', '@mui/styled-engine', '@mui/utils', '@mui/private-theming', '@emotion/react', '@emotion/styled', '@emotion/cache'];

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

const argv = process.argv.slice(2);
// `--build <dir>`: check a production build of this app (served by `vite preview`) instead of the dev server.
const BUILD_DIR = argv.includes('--build') ? path.resolve(argv[argv.indexOf('--build') + 1] || '') : null;
const modes = BUILD_DIR ? ['build'] : argv.filter((a) => a === 'source' || a === 'dist');
const GUI_VERSION = JSON.parse(fs.readFileSync(path.join(GUI, 'package.json'), 'utf8')).version;
// What today's GUI shows on its own pages: a build or a dist that lacks it is not the current GUI.
const CURRENT_GUI = { '/GUI': `.GUI ${GUI_VERSION}`, '/GUI/themes': 'GUI / Themes', '/GUI/layout': 'parts declared' };
// KNOWN is narrow on purpose. Only these, and only as named here, are not failures:
// - in dist mode, the absence of a page today's GUI has and GUI's committed dist/ predates (that dist is rebuilt
//   separately);
// - in any mode, a link offered disabled because its page needs a monad this check runs without.
// Anything else missing, any page error, a broken route or a duplicated package fails, in every mode.
const NEWER_THAN_DIST = new Set(['/GUI', '/GUI/themes', '/GUI/themes/typography', '/GUI/layout']);
const NEEDS_A_LAYER = new Set(['/users', '/monad']);

// The app as each mode serves it: the dev server, or `vite preview` of a production build.
function startApp(mode, backend, { force = false } = {}) {
  const env = { ...process.env, BROWSER: 'none', NETGET_BACKEND: backend };
  if (mode === 'dist') env.THIS_GUI = 'dist';
  else delete env.THIS_GUI;
  const args = mode === 'build'
    ? ['vite', 'preview', '--outDir', BUILD_DIR, '--port', String(PORT), '--strictPort']
    : ['vite', '--port', String(PORT), '--strictPort', ...(force ? ['--force'] : [])];
  return spawn('npx', args, { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Which on-disk copy of each shared package a production bundle contains, from its sourcemaps.
function bundleRoots(dir) {
  const roots = {};
  const guiDist = new Set();
  const maps = fs.readdirSync(dir).filter((f) => f.endsWith('.map'));
  for (const f of maps) {
    const map = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const src of map.sources) {
      const abs = path.resolve(dir, map.sourceRoot || '', src);
      const m = abs.match(/^(.*\/node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*))\//);
      if (m && SHARED.includes(m[2])) (roots[m[2]] ??= new Set()).add(m[1]);
      const d = abs.match(/^(.*\/dist)\//);
      if (d && /this\.gui|packages\/GUI/.test(d[1])) guiDist.add(d[1]);
    }
  }
  return { roots, guiDist, maps: maps.length };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const report = (status, name, info = '') => {
  if (status === 'FAIL') failed += 1;
  console.log(`${status} ${name}${info ? ` — ${info}` : ''}`);
};
const verdict = (pass) => (pass ? 'PASS' : 'FAIL');

async function checkMode(mode) {
  console.log(`\n== ${mode} ==`);
  const vite = startApp(mode, DEAD_BACKEND, { force: true });
  let log = '';
  vite.stdout.on('data', (d) => (log += d));
  vite.stderr.on('data', (d) => (log += d));
  const original = fs.readFileSync(MARK_FILE, 'utf8');
  let browser;
  try {
    for (let i = 0; i < 80 && !log.includes('Local:'); i++) await wait(500);
    if (!log.includes('Local:')) throw new Error(`dev server did not start:\n${log}`);
    report(verdict(mode === 'build' || log.includes('[this.gui] source:') === (mode === 'source')), mode === 'build' ? 'serving the production build' : 'dev server mode', mode === 'build' ? BUILD_DIR : mode);

    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP local.cleaker 127.0.0.1`] });
    const urls = [];
    const outside = [];
    for (const surface of SURFACES) {
      console.log(`  -- ${surface.name} (${surface.origin})`);
      const page = await browser.newPage();
      let errors = [];
      // WebSockets are not covered by page.route: closed here, and counted, before they open.
      // (the dev server's own HMR socket is let through).
      const devHost = new URL(surface.origin).host;
      await page.context().routeWebSocket((u) => u.host !== devHost, (ws) => { outside.push(`WS ${ws.url()}`); ws.close(); });
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(surface.origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        outside.push(`${route.request().method()} ${u}`);
        return route.abort();
      });
      page.on('request', (r) => urls.push(r.url()));
      page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
      page.on('console', (m) => {
        // Refused calls are expected (dead backend, aborted outside requests); anything else is a real error.
        if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ECONNREFUSED|net::|status of 50\d|Failed to fetch/.test(m.text())) errors.push(m.text().split('\n')[0]);
      });
      const predatesDist = new Set();
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
        if (CURRENT_GUI[route] && surface.name === 'namespace door') {
          const has = shown.includes(CURRENT_GUI[route]);
          const predates = !has && mode === 'dist' && NEWER_THAN_DIST.has(route);
          if (predates) predatesDist.add(route);
          report(has ? 'PASS' : predates ? 'KNOWN' : 'FAIL', `${route} is today's GUI`, has ? `"${CURRENT_GUI[route]}"` : `"${CURRENT_GUI[route]}" not shown${predates ? ' (this dist predates it)' : ''}`);
        }
      }
      // Themes: the mode toggle changes the page's colors through the shared theme, and back.
      if (surface.name === 'namespace door') {
        await page.goto(`${surface.origin}/GUI/themes`);
        await settle();
        const toggle = page.locator('button[aria-label="toggle theme mode"]').first();
        const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        if (await toggle.count()) {
          const before = await bg();
          await toggle.click(); await wait(800);
          const after = await bg();
          await toggle.click(); await wait(800);
          const restored = await bg();
          report(verdict(before !== after && restored === before), 'theme mode toggles the page colors and back', `${before} -> ${after} -> ${restored}`);
        } else {
          // KNOWN only when the themes page itself was found to predate this dist above.
          const predates = predatesDist.has('/GUI/themes');
          report(predates ? 'KNOWN' : 'FAIL', 'theme mode toggles the page colors and back', `no theme mode toggle${predates ? ' (this dist predates the page)' : ''}`);
        }
      }
      for (const route of surface.proxiedInDev) report('KNOWN', `${route} not covered`, 'the dev server proxies it to the API, and its link needs a backend that answers');

      for (const { from, to, tab } of surface.navigation) {
        errors = [];
        await page.goto(`${surface.origin}${from}`);
        await settle();
        const link = tab ? page.getByRole('tab', { name: tab }).first() : page.locator(`a[href="${to}"]`).first();
        if ((await link.count()) && (await link.getAttribute('aria-disabled')) === 'true') {
          report(NEEDS_A_LAYER.has(to) ? 'KNOWN' : 'FAIL', `navigate ${from} -> ${to} -> Back`, NEEDS_A_LAYER.has(to)
            ? 'the link is offered disabled: its page needs a monad this check runs without'
            : 'the link is offered disabled, and nothing says it should be');
          continue;
        }
        if (!(await link.count())) {
          const predates = mode === 'dist' && NEWER_THAN_DIST.has(to) && NEWER_THAN_DIST.has(from);
          report(predates ? 'KNOWN' : 'FAIL', `navigate ${from} -> ${to} -> Back`, `no link to ${to} on ${from}${predates ? ' (this dist predates both pages)' : ''}`);
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

    if (mode === 'build') {
      const { roots: bundled, guiDist, maps } = bundleRoots(path.join(BUILD_DIR, 'assets'));
      report(verdict(maps > 0), 'the build has sourcemaps to inspect', maps ? `${maps} maps` : 'build it with --sourcemap');
      report(verdict(guiDist.size === 1), 'this.gui origin', [...guiDist].join(' + ') || 'no this.gui dist in the bundle');
      const dup = Object.entries(bundled).filter(([, set]) => set.size > 1);
      report(verdict(maps > 0 && dup.length === 0 && ['react', 'react-dom', 'react-router', '@mui/material', '@mui/system', '@emotion/react', '@emotion/cache'].every((k) => bundled[k])),
        'one copy each of React, Router, MUI, Emotion in the bundle',
        dup.length ? dup.map(([k, set]) => `${k}: ${[...set].join(' + ')}`).join('; ') : `${Object.keys(bundled).length} packages, one root each`);
      console.log(`     requests outside the app, stopped by the browser (never sent): ${outside.length}${outside.length ? ` (${[...new Set(outside)].slice(0, 4).join(', ')})` : ''}`);
      return;
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
    const fromGuiModules = urls.filter((u) => /packages\/GUI\/Typescript\/node_modules\/(react|react-dom|react-router|react-router-dom|@mui|@emotion)\//.test(u));
    const describe = (list) => list.map(([k, s]) => `${k}: ${[...s].map((r) => path.relative(ALL_THIS, r)).join(' + ')}`).join('; ');
    report(verdict(multi.length === 0 && fromGuiModules.length === 0), 'one copy each of React, Router, MUI, Emotion',
      multi.length ? describe(multi) : fromGuiModules.length ? fromGuiModules[0] : `${Object.keys(roots).length} packages, one root each`);

    // One React Router for the app and GUI, the major GUI declares.
    const installed = ['react-router', 'react-router-dom'].map((p) => JSON.parse(fs.readFileSync(path.join(APP, 'node_modules', p, 'package.json'), 'utf8')).version);
    const guiRange = JSON.parse(fs.readFileSync(path.join(GUI, 'package.json'), 'utf8')).peerDependencies?.['react-router-dom'] || '';
    const guiMajor = (guiRange.match(/(\d+)\./) || [])[1];
    const majors = new Set(installed.map((v) => v.split('.')[0]));
    report(verdict(majors.size === 1 && [...majors][0] === guiMajor && (roots['react-router']?.size ?? 0) <= 1 && (roots['react-router-dom']?.size ?? 0) <= 1),
      'one React Router, the version GUI declares', `react-router ${installed[0]}, react-router-dom ${installed[1]}; GUI declares ${guiRange}`);
    console.log(`     requests outside the dev server, stopped by the browser (never sent): ${outside.length}${outside.length ? ` (${[...new Set(outside)].slice(0, 4).join(", ")})` : ""}`);
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

// With the test backend (scripts/testBackend.mjs): Domains, Logs, a session and the permissions that follow from it.
// The dev server proxies the API to that backend; the browser still aborts every request outside the dev server.
async function checkWithBackend(mode) {
  console.log(`\n== ${mode}, with the test backend ==`);
  const origin = `http://127.0.0.1:${PORT}`;
  const backend = await startTestBackend({ appOrigin: origin });
  const vite = startApp(mode, backend.origin);
  let log = '';
  vite.stdout.on('data', (d) => (log += d));
  vite.stderr.on('data', (d) => (log += d));
  let browser;
  const outside = [];
  const warnings = new Set();
  try {
    for (let i = 0; i < 80 && !log.includes('Local:'); i++) await wait(500);
    if (!log.includes('Local:')) throw new Error(`dev server did not start:\n${log}`);
    browser = await chromium.launch();

    const open = async () => {
      const context = await browser.newContext();
      // WebSockets are not covered by page.route: any but the dev server's own HMR socket is closed, and counted.
      await context.routeWebSocket((u) => u.host !== new URL(origin).host, (ws) => { outside.push(`WS ${ws.url()}`); ws.close(); });
      const page = await context.newPage();
      const errors = [];
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        outside.push(`${route.request().method()} ${u}`);
        return route.abort();
      });
      page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
      page.on('console', (m) => {
        if (m.type() !== 'error' || /Failed to load resource|status of 404|WebSocket|net::/.test(m.text())) return;
        // React's development warnings (keys, props) are logged as errors; they are noted, not failures.
        if (/^Warning: /.test(m.text())) warnings.add(m.text().split('\n')[0].replace(/%s/g, '').trim());
        else errors.push(m.text().split('\n')[0]);
      });
      await page.goto(`${origin}/`);
      await page.waitForLoadState('load');
      await wait(2000);
      return { context, page, errors };
    };
    const text = (page) => page.evaluate(() => document.body.innerText);
    const offered = (page) => page.evaluate(() => Object.fromEntries(['/domains', '/logs'].map((href) => {
      const a = document.querySelector(`a[href="${href}"]`);
      return [href, a ? (a.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'yes') : 'no'];
    })));
    const until = (page, fn, arg, timeout = 6000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
    const signIn = async (page) => {
      const way = page.getByText(/Open your \.me/i).first();
      if (await way.count()) await way.click();
      await until(page, () => !!document.querySelector('input[type=password]'));
      await page.fill('input[type=text]:not([placeholder])', 'ana');
      await page.fill('input[type=password]', 'secret-a');
      await page.click('button:has-text(".me"):not([disabled])', { timeout: 5000 });
      return until(page, () => /Sign out/i.test(document.body.innerText));
    };
    const offeredAfterAuth = async (page, expect) => {
      await until(page, (e) => ['/domains', '/logs'].every((h) => {
        const a = document.querySelector(`a[href="${h}"]`);
        return (a ? (a.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'yes') : 'no') === e[h];
      }), expect, 6000);
      return offered(page);
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // 1. No session: neither is offered, and typing their routes does not show them.
    {
      backend.setScenario('none');
      const { context, page, errors } = await open();
      const o = await offered(page);
      report(verdict(o['/domains'] !== 'yes' && o['/logs'] !== 'yes'), 'no session: Domains and Logs not offered', JSON.stringify(o));
      for (const [route, marker] of [['/domains', DOMAIN_ROW.domain], ['/logs', LOG_LINE.path]]) {
        await page.goto(`${origin}${route}`);
        await wait(2500);
        report(verdict(!(await text(page)).includes(marker) && errors.length === 0), `no session: ${route} typed directly is not shown`, errors.slice(0, 1).join(''));
      }
      await context.close();
    }

    // 2. The owner (recognized, with logs-read): both offered; their pages show the backend's data; navigation and Back.
    {
      backend.setScenario('owner');
      const { context, page, errors } = await open();
      report(verdict(await signIn(page)), 'owner: signs in through the selected link');
      const o = await offeredAfterAuth(page, { '/domains': 'yes', '/logs': 'yes' });
      report(verdict(same(o, { '/domains': 'yes', '/logs': 'yes' })), 'owner: Domains and Logs offered', JSON.stringify(o));
      const start = await page.evaluate(() => location.pathname);
      await page.evaluate(() => { window.__navMark = 'kept'; });
      const steps = [];
      for (const [route, marker] of [['/domains', DOMAIN_ROW.domain], ['/logs', LOG_LINE.path]]) {
        errors.length = 0;
        const link = page.locator(`a[href="${route}"]`).first();
        if (!(await link.count())) { report('FAIL', `owner: ${route} by its link`, 'no link'); continue; }
        await link.click();
        const shown = await until(page, (m) => document.body.innerText.includes(m), marker);
        steps.push(await page.evaluate(() => location.pathname));
        report(verdict(shown && errors.length === 0), `owner: ${route} by its link shows the backend's data`, shown ? `"${marker}"` : errors.slice(0, 1).join('') || `"${marker}" not shown`);
      }
      errors.length = 0;
      await page.goBack(); await wait(1200);
      const back1 = await page.evaluate(() => [location.pathname, window.__navMark]);
      await page.goBack(); await wait(1200);
      const back2 = await page.evaluate(() => [location.pathname, window.__navMark]);
      report(verdict(same(steps, ['/domains', '/logs']) && back1[0] === '/domains' && back2[0] === start && back1[1] === 'kept' && back2[1] === 'kept' && errors.length === 0),
        `owner: ${start} -> /domains -> /logs, Back, Back (no reload)`, `${steps.join(' -> ')}, back to ${back1[0]}, ${back2[0]}${back2[1] ? '' : ' (reloaded)'}`);
      // Sign out, reached inside the app (the card's page): what the session granted is no longer offered.
      errors.length = 0;
      const me = page.locator('a[href="/.me"]').first();
      if (await me.count()) await me.click();
      await until(page, () => /Sign out/i.test(document.body.innerText));
      const out = page.getByText(/Sign out/i).first();
      if (await out.count()) {
        await out.click();
        const after = await offeredAfterAuth(page, { '/domains': 'no', '/logs': 'no' });
        report(verdict(after['/domains'] !== 'yes' && after['/logs'] !== 'yes'), 'owner: after Sign out, neither is offered', JSON.stringify(after));
      } else report('FAIL', 'owner: after Sign out, neither is offered', `no Sign out control: ${(await text(page)).replace(/\s+/g, ' ').slice(0, 160)}`);
      // A reload (a bookmarked /logs): the session is not kept across a page load today, so the page is not shown,
      // and the app comes up with no error.
      errors.length = 0;
      await page.goto(`${origin}/logs`);
      await wait(3000);
      const shownAfterReload = (await text(page)).includes(LOG_LINE.path);
      report(verdict(!shownAfterReload && errors.length === 0), 'owner: reload on /logs comes up signed out, Logs not shown', errors.slice(0, 1).join(''));
      await context.close();
    }

    // 3. An admin without logs-read: Domains, not Logs. 4. Recognized but neither: nothing.
    for (const [scenario, expect, name] of [
      ['admin', { '/domains': 'yes', '/logs': 'no' }, 'admin without logs-read: Domains offered, Logs not'],
      ['stranger', { '/domains': 'no', '/logs': 'no' }, 'signed in, not an admin: neither offered'],
    ]) {
      backend.setScenario(scenario);
      const { context, page } = await open();
      const signed = await signIn(page);
      const o = await offeredAfterAuth(page, expect);
      report(verdict(signed && same(o, expect)), name, JSON.stringify(o));
      await context.close();
    }

    for (const w of warnings) console.log(`     note: React warned: ${w}`);
    report(verdict(backend.writes.length === 0), 'no write reached the test backend', backend.writes.slice(0, 5).join(', '));
    if (backend.unknown.length) console.log(`     asked of the test backend and not answered: ${[...new Set(backend.unknown)].join(', ')}`);
    console.log(`     requests outside the dev server, stopped by the browser (never sent): ${outside.length}${outside.length ? ` (${[...new Set(outside)].slice(0, 4).join(', ')})` : ''}`);
  } finally {
    await browser?.close();
    vite.kill('SIGTERM');
    for (let i = 0; i < 20 && vite.exitCode === null; i++) await wait(200);
    if (vite.exitCode === null) vite.kill('SIGKILL');
    await backend.close();
  }
}

for (const mode of modes.length ? modes : ['source', 'dist']) {
  await checkMode(mode);
  await checkWithBackend(mode);
}
console.log(failed ? `\n${failed} failed` : '\nno failures');
process.exit(failed ? 1 : 0);
