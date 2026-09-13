import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenvFlow from 'dotenv-flow';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import localNetgetRoutes from './routes/localNetget.js';
import setupSessionRoutes from './routes/setupSession.js';
import openRestyInstallRoutes from './routes/openRestyInstall.js';
import adminSessionRoutes from './routes/adminSession.js';
import gatewayAdminRoutes from './routes/gatewayAdmin.js';
import { startNetgetMonad, stopNetgetMonad, loadGatewayRootNamespaceCache, getGatewayRootNamespace } from '../../../kernel/netgetMonadProcess.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, 'env');

dotenvFlow.config({
    path: envPath,
    pattern: '.env[.node_env]',
    default_node_env: 'development'
});

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// local.netget is loopback-only — nginx enforces this at the network level.
// No auth layer needed in the GUI backend itself.
//
// local.cleaker is allowed here specifically for /admin-session/challenge
// and /admin-session/verify (adminSession.ts / routes/adminSession.js) —
// CleakerNetgetAdminSignView (CleakerLanding.tsx) calls both cross-origin,
// directly from local.cleaker, as part of proving a real signature before
// minting a session token. CORS alone grants no capability by itself —
// those two routes still require a real signature from a registered
// admin key; this only lets the browser's own same-origin policy stop
// blocking a call this flow is supposed to make.
app.use(bodyParser.json());
app.use(cors({
    origin: function (origin, callback) {
        // Allow local origins and same-origin requests
        const allowed = !origin
            || origin.includes('local.netget')
            || origin.includes('local.cleaker')
            || origin.includes('localhost')
            || origin.includes('127.0.0.1');
        if (allowed) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
}));

app.use('/', setupSessionRoutes);
app.use('/', localNetgetRoutes);
app.use('/', openRestyInstallRoutes);
app.use('/', adminSessionRoutes);
app.use('/', gatewayAdminRoutes);

// Serves the setup SPA directly from this bootstrap port — deliberately
// NOT dependent on OpenResty being installed or running at all. Before
// today, the built frontend was only ever served by OpenResty's own
// nginx `root`/`try_files` (setNginxConfigRoutes.ts), so there was no way
// to reach the setup screen — including the screen that offers to install
// OpenResty in the first place — until OpenResty already existed. That's
// the actual gap this closes: a genuinely fresh install can now open
// http://127.0.0.1:3000/ (or whatever PORT is set to) and see setup,
// dependencies and all, before OpenResty is on the machine at all.
// Loopback-only, same as this whole backend (app.listen below) — this
// does not expose setup to the LAN, only to this machine.
const spaDistDir = path.join(__dirname, '../../../../assets/main-server-ui/dist');
if (fs.existsSync(spaDistDir)) {
    app.use(express.static(spaDistDir));
    // Reached only when nothing above matched — every mounted API router
    // (setupSessionRoutes/localNetgetRoutes/openRestyInstallRoutes) already
    // claimed its own paths and would have responded before this runs, so
    // no path exclusion list is needed here: this really is "not an API
    // route," not a guess at one.
    app.get('*', (req, res, next) => {
        res.sendFile(path.join(spaDistDir, 'index.html'), (err) => {
            if (err) next(err);
        });
    });
} else {
    console.warn(chalk.yellow(`Bootstrap SPA not found at ${spaDistDir} — run the frontend_local build first.`));
}

app.listen(PORT, '127.0.0.1', () => {
    console.log(chalk.green(`NetGet local GUI backend on port ${PORT} (${NODE_ENV})`));
});

// Tells whichever monad THIS process spawns next where to proxy `logs`/
// `logs.*` NRP reads (monad.ai's pathResolver.ts, generic — it has no idea
// this points at netget specifically). startMonadProcess() (monad.ai's
// runtime.ts) builds its child's env as `{ ...process.env, ... }`, so
// setting this on OUR OWN process.env before startNetgetMonad() below is
// spawned is sufficient — no monad.ai code needs a netget-specific env var
// name. Never overridden if already set (a disposable test's own fixed
// value, or a future real deployment pointing this at a different port).
if (!process.env.LOG_SOURCE_URL) {
    process.env.LOG_SOURCE_URL = `http://127.0.0.1:${PORT}`;
}

// netget runs its own monad.ai instance instead of an embedded kernel
// (domainStore.ts talks to it over HTTP — see kernel/netgetMonadProcess.ts).
// Domain CRUD depends on this being up; routing itself does not (Lua polls
// domain-map.json on disk, unaffected if this process is briefly down).
// The mainServerName cache must load BEFORE the monad starts — it decides
// which namespace the monad process itself starts under
// (getGatewayRootNamespace(), read inside startNetgetMonad()).
loadGatewayRootNamespaceCache().then(() => {
    // The EXACT namespace pathResolver.ts's logs branch must match before
    // it will proxy anything — same "netget.<root>" convention
    // domainStore.ts's own indexNamespace() already uses for its
    // ownerless infra writes (domainIndex etc.), so a read of
    // "logs.access" under any OTHER namespace never gets intercepted:
    // two different namespaces asking for "logs.access" must not both
    // get handed this host's own nginx logs. Set AFTER the cache loads
    // (getGatewayRootNamespace() depends on it) but still before
    // startNetgetMonad() spawns, so the child inherits it the same way
    // as LOG_SOURCE_URL above.
    if (!process.env.LOG_SOURCE_NAMESPACE) {
        process.env.LOG_SOURCE_NAMESPACE = `netget.${getGatewayRootNamespace()}`;
    }
    return startNetgetMonad();
}).then((status) => {
    if (status.ok) {
        console.log(chalk.cyan(`netget monad: ${status.message}`));
    } else {
        console.warn(chalk.yellow(`netget monad failed to start: ${status.message}`));
    }
});

async function shutdown(signal) {
    console.log(chalk.gray(`${signal} received, stopping netget's own monad...`));
    await stopNetgetMonad();
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));


// ─── Log parsing utilities (used by routes/localNetget.js's /logs route) ──
// Moved to logParsers.js to break a circular import (localNetget.js used
// to import parseLogLine back from here, while this file imports
// localNetgetRoutes FROM localNetget.js — a cycle that only worked
// because this file always happened to be the real entrypoint in
// production). Re-exported here so nothing importing parseLogLine from
// proxy.js specifically has to change.
export { parseLogLine } from './logParsers.js';
