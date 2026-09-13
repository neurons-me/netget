/**
 * OpenResty install routes — the browser's side of the ONE unattended
 * install action this codebase can run safely from an HTTP request today
 * (see openRestyInstallJob.ts's header for exactly why only Homebrew's
 * binary install qualifies, never starting the gateway itself).
 *
 * Every route here requires checkInstallActionAuth() (installActionAuth.ts)
 * — a setup-session token before this gateway has an owner, real admin
 * scopes after. "This request came from localhost" is deliberately never
 * treated as sufficient on its own, even though other routes in this
 * backend do rely on that (see localNetget.js's own header comment) — see
 * installActionAuth.ts for the reasoning and its one open caveat.
 */
import express from "express";
import { canInstallOpenRestyViaHomebrew } from "../../../../modules/NetGetX/OpenResty/openRestyService.ts";
import { startInstallJob, getInstallJobSnapshot } from "../../../../modules/NetGetX/OpenResty/openRestyInstallJob.ts";
import { checkInstallActionAuth } from "../../../../modules/NetGetX/Auth/installActionAuth.ts";
import { getInstallInstructions } from "../../../../modules/NetGetX/OpenResty/platformDetect.ts";

const router = express.Router();

function requireAuth(req, res) {
    const auth = checkInstallActionAuth(req);
    if (!auth.ok) {
        res.status(auth.status).json({ ok: false, error: auth.error });
        return null;
    }
    return auth;
}

router.get('/openresty/install/availability', (req, res) => {
    if (!requireAuth(req, res)) return;
    const availability = canInstallOpenRestyViaHomebrew();
    res.json({
        ok: true,
        ...availability,
        // Public in the sense that `netget` already prints the same text
        // to anyone with a shell on this machine — sending it here isn't a
        // new disclosure, just the same non-actionable info on the screen
        // that's asking for it.
        terminalInstructions: availability.available ? undefined : getInstallInstructions(),
    });
});

router.post('/openresty/install', (req, res) => {
    if (!requireAuth(req, res)) return;
    const result = startInstallJob();
    res.status(result.ok ? 200 : 409).json(result);
});

router.get('/openresty/install/progress', (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json({ ok: true, job: getInstallJobSnapshot() });
});

export default router;
