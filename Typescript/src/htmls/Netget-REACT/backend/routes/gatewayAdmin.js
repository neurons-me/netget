/**
 * gateway-admin routes — thin HTTP surface over gatewayAdminActions.ts.
 * Netget performs no verification here; every proof is forwarded to the
 * target monad's own signed claim/gatewayAuthority.ts, which independently
 * re-verifies the signature and the acting identity's gateway authority.
 * See gatewayAdminActions.ts's own header for the full reasoning.
 */
import express from "express";
import {
    grantGatewayAdmin,
    revokeGatewayAdmin,
    transferGatewayOwner,
} from "../../../../modules/NetGetX/Auth/gatewayAdminActions.ts";

const router = express.Router();

router.post('/gateway-admin/grant', async (req, res) => {
    const body = req.body ?? {};
    const result = await grantGatewayAdmin({
        gatewayId: String(body.gatewayId || ''),
        namespace: String(body.namespace || ''),
        actingKeyId: String(body.actingKeyId || ''),
        targetIdentityHash: String(body.targetIdentityHash || ''),
        targetNamespace: String(body.targetNamespace || ''),
        targetPublicKey: body.targetPublicKey ?? null,
        targetUsername: body.targetUsername ?? null,
        scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
        nonce: String(body.nonce || ''),
        timestamp: Number(body.timestamp || 0),
        signature: String(body.signature || ''),
        signedPayload: body.signedPayload ? String(body.signedPayload) : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
});

router.post('/gateway-admin/revoke', async (req, res) => {
    const body = req.body ?? {};
    const result = await revokeGatewayAdmin({
        gatewayId: String(body.gatewayId || ''),
        namespace: String(body.namespace || ''),
        actingKeyId: String(body.actingKeyId || ''),
        targetIdentityHash: String(body.targetIdentityHash || ''),
        nonce: String(body.nonce || ''),
        timestamp: Number(body.timestamp || 0),
        signature: String(body.signature || ''),
        signedPayload: body.signedPayload ? String(body.signedPayload) : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
});

router.post('/gateway-admin/transfer', async (req, res) => {
    const body = req.body ?? {};
    const result = await transferGatewayOwner({
        gatewayId: String(body.gatewayId || ''),
        namespace: String(body.namespace || ''),
        actingKeyId: String(body.actingKeyId || ''),
        targetIdentityHash: String(body.targetIdentityHash || ''),
        nonce: String(body.nonce || ''),
        timestamp: Number(body.timestamp || 0),
        signature: String(body.signature || ''),
        signedPayload: body.signedPayload ? String(body.signedPayload) : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
});

export default router;
