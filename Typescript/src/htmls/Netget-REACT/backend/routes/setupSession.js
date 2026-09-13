/**
 * setup-session routes — the browser's side of gatewaySetupSession.ts.
 *
 * Thin on purpose: every route is a direct pass-through to the shared
 * bootstrap service the CLI (`netget init`/`netget claim`) also calls
 * in-process — see that module's header comment for why this is the one
 * real mechanism behind "CLI and browser use the same service and the
 * same validations," not two implementations that happen to agree.
 *
 * Never log request bodies here — `code`, `setupToken`, and the signed
 * `proof` all belong to a temporary access gate that must never end up in
 * a log line (this app has no request-logging middleware to begin with —
 * proxy.js — so there is nothing to redact, only new logging to avoid
 * introducing).
 */
import express from "express";
import { verifySetupCode, issueClaimChallenge, commitSignedClaim } from "../../../../modules/NetGetX/Auth/gatewaySetupSession.ts";

const router = express.Router();

router.post('/setup/verify-code', (req, res) => {
    const code = String(req.body?.code || '');
    const result = verifySetupCode(code);
    if (!result.ok) return res.status(401).json(result);
    res.json(result);
});

router.post('/setup/challenge', (req, res) => {
    const setupToken = String(req.body?.setupToken || '');
    const returnOrigin = String(req.body?.returnOrigin || '');
    const returnPath = String(req.body?.returnPath || '');
    const result = issueClaimChallenge(setupToken, returnOrigin, returnPath);
    if (!result.ok) return res.status(401).json(result);
    res.json(result);
});

router.post('/setup/claim', async (req, res) => {
    const setupToken = String(req.body?.setupToken || '');
    const proof = req.body?.proof;

    if (!proof || typeof proof !== 'object') {
        return res.status(400).json({ ok: false, message: 'proof is required' });
    }

    const result = await commitSignedClaim(setupToken, proof);
    res.status(result.ok ? 200 : 400).json(result);
});

export default router;
