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
    // returnOrigin/returnPath are optional -- see issueAdminSessionChallenge's
    // own doc comment. When the caller supplies them, this commits THIS
    // challenge to that exact destination; verify below then holds it to it.
    const returnOrigin = req.body?.returnOrigin ? String(req.body.returnOrigin) : undefined;
    const returnPath = req.body?.returnPath ? String(req.body.returnPath) : undefined;
    const result = issueAdminSessionChallenge(identityHash, undefined, returnOrigin, returnPath);
    res.status(result.ok ? 200 : 401).json(result);
});

router.post('/admin-session/verify', async (req, res) => {
    const identityHash = String(req.body?.identityHash || '');
    const namespace = String(req.body?.namespace || '');
    const keyId = String(req.body?.keyId || '');
    const signature = String(req.body?.signature || '');
    const returnOrigin = req.body?.returnOrigin ? String(req.body.returnOrigin) : undefined;
    const returnPath = req.body?.returnPath ? String(req.body.returnPath) : undefined;
    const result = await verifyAdminSessionChallenge(identityHash, namespace, keyId, signature, undefined, returnOrigin, returnPath);
    res.status(result.ok ? 200 : 401).json(result);
});

export default router;
