// testHarness.mjs — lets a test outside this directory (tests/ lives
// under netget/Typescript, a SEPARATE Node project from this backend/
// directory's own package.json/node_modules) mount the real
// localNetget.js router without needing its own `express` import to
// resolve across that boundary. Also used (with `cors` set) by the
// dev-harness/logs-harness-server.mjs manual-verification harness — still
// never imported by proxy.js or any production entrypoint.
import express from 'express';
import bodyParser from 'body-parser';
import localNetgetRoutes from './routes/localNetget.js';
import adminSessionRoutes from './routes/adminSession.js';

export function createLocalNetgetTestApp(options = {}) {
    const app = express();
    if (options.cors) {
        // Mirrors proxy.js's own CORS extension for local.cleaker: lets a
        // manual-verification harness serve its "netget role" AND "Cleaker
        // role" pages on two DIFFERENT origins and still reach /logs and
        // /admin-session/* directly, the same real cross-origin shape
        // production has for the Cleaker leg. Both origins are needed here
        // (unlike production, where the netget role is same-origin with
        // its own backend) because this harness's "netget role" demo page
        // is ALSO served by a separate dev server, not this Express app.
        // CORS headers alone grant no capability -- every route below
        // still requires a real signature/session.
        const allowedOrigins = new Set(
            Array.isArray(options.cors.origin) ? options.cors.origin : [options.cors.origin],
        );
        app.use((req, res, next) => {
            if (req.headers.origin && allowedOrigins.has(req.headers.origin)) {
                res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
            }
            if (req.method === 'OPTIONS') return res.sendStatus(204);
            next();
        });
    }
    app.use(bodyParser.json());
    app.use('/', localNetgetRoutes);
    app.use('/', adminSessionRoutes);
    return app;
}
