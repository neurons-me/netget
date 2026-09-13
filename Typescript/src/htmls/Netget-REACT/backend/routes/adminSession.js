/**
 * admin-session routes — real, signed authentication for admin-only reads
 * (starting with /logs) that must be safe to trust even when reached
 * directly (bootstrap port, or via monad.ai's own HTTP surface), not only
 * when nginx's me_sig.lua happened to run first. See adminSession.ts's
 * own header for the gap this closes and why.
 */
import express from "express";
import { issueAdminSessionChallenge, verifyAdminSessionChallenge } from "../../../../modules/NetGetX/Auth/adminSession.ts";

const router = express.Router();

router.post('/admin-session/challenge', (req, res) => {
    const identityHash = String(req.body?.identityHash || '');
    const result = issueAdminSessionChallenge(identityHash);
    res.status(result.ok ? 200 : 401).json(result);
});

router.post('/admin-session/verify', async (req, res) => {
    const identityHash = String(req.body?.identityHash || '');
    const namespace = String(req.body?.namespace || '');
    const keyId = String(req.body?.keyId || '');
    const signature = String(req.body?.signature || '');
    const result = await verifyAdminSessionChallenge(identityHash, namespace, keyId, signature);
    res.status(result.ok ? 200 : 401).json(result);
});

export default router;
