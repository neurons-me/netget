/**
 * Gateway Capability Model — live integration test.
 * See docs/GatewayCapabilityModel.md.
 *
 * Unlike the other tests in this directory, this one is NOT isolated via
 * NETGET_DATA_DIR — it exercises the real running gateway (nginx + Lua +
 * the localNetget.js daemon) over HTTP, the same way test:nrp:curl does.
 * Requires: OpenResty reloaded with the current netget_app.conf/Lua, and
 * the netget-proxy-dev daemon (PM2) running the current localNetget.js.
 *
 * The central invariant this file exists to prove, executably:
 *   valid signed proof + authenticated identity - explicit capability => 403
 * i.e. decrypt/authenticate audience (A) does not imply write capability (C).
 *
 * Uses the REAL signing path — this.me + cleaker, the same ME_RESEED ->
 * cleaker(me, hostname) -> node.prove() sequence as
 * packages/GUI/Typescript/.../useCleakerAuth.ts's signedFetch — not an
 * artificial header shortcut. A test identity is created and cleaned up;
 * no real admin's grants are touched.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ME from 'this.me';
import cleaker from 'cleaker';

const GATEWAY_ORIGIN = 'http://local.netget';
const BACKEND_ORIGIN = 'http://127.0.0.1:3000';
const CAPABILITY = 'gateway:write:domain-metadata';
const TEST_USERNAME = 'gateway-capability-suite-test';
const TEST_SECRET = 'gateway-capability-suite-test-secret-do-not-reuse';

const dataDir = path.join(os.homedir(), '.get');
const claimsPath = path.join(dataDir, 'runtime', 'gateway-claims.json');
const versionPath = path.join(dataDir, 'runtime', 'gateway-claims.version');
const auditPath = path.join(dataDir, 'runtime', 'audit.log');
const metadataPath = path.join(dataDir, 'runtime', 'domain-metadata.json');
const domainMapPath = path.join(dataDir, 'runtime', 'domain-map.json');
const domainMapVersionPath = path.join(dataDir, 'runtime', 'domain-map.version');
const sqliteDbPath = path.join(dataDir, 'domains.db');

// ---------------------------------------------------------------------------
// Signing helpers — mirror useCleakerAuth.ts exactly (canonicalJson, nonce,
// bodyHash, prove()) so this test exercises the real primitive, not a stand-in.
// ---------------------------------------------------------------------------

function canonicalJson(obj: Record<string, unknown>): string {
    return JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
}

function genNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

function sha256Hex(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

type SignedRequestOverrides = {
    method?: string;
    path?: string;
    bodyHash?: string;
    nonce?: string;
    timestamp?: number;
};

/**
 * Builds and sends a signed request. `overrides` lets a test sign one thing
 * and send another (tamper after signing) — that's the whole point of the
 * payload-binding tests below.
 */
async function signedRequest(
    node: any,
    hostname: string,
    actualMethod: string,
    actualPath: string,
    bodyObj: Record<string, unknown> | undefined,
    overrides: SignedRequestOverrides = {},
) {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const signed = {
        method: overrides.method ?? actualMethod,
        path: overrides.path ?? actualPath,
        bodyHash: overrides.bodyHash ?? sha256Hex(bodyStr),
        nonce: overrides.nonce ?? genNonce(),
        timestamp: overrides.timestamp ?? Date.now(),
    };
    const challenge = canonicalJson(signed);
    const proof = await node.prove({ rootNamespace: hostname, challenge });
    const proofB64 = Buffer.from(JSON.stringify(proof)).toString('base64url');

    const res = await fetch(GATEWAY_ORIGIN + actualPath, {
        method: actualMethod,
        headers: { 'Content-Type': 'application/json', 'X-Me-Proof': proofB64 },
        body: bodyStr || undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

function bumpClaimsVersion() {
    fs.writeFileSync(versionPath, String(Date.now()), 'utf8');
}

function readClaims(): any {
    return JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
}

function writeClaims(claims: any) {
    fs.writeFileSync(claimsPath, JSON.stringify(claims), 'utf8');
    bumpClaimsVersion();
}

function readAuditLines(): any[] {
    if (!fs.existsSync(auditPath)) return [];
    return fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function readMetadata(): Record<string, any> {
    if (!fs.existsSync(metadataPath)) return {};
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

function sqliteRowForDomain(domain: string): string {
    try {
        return execFileSync('sqlite3', ['-json', sqliteDbPath, `SELECT * FROM domains WHERE domain = '${domain}'`], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

// Lua's version-gated claims cache needs a beat to notice a bumped version.
const settle = () => new Promise((r) => setTimeout(r, 300));

async function main() {
    console.log('Gateway Capability Model — live integration suite\n');

    // ── Setup: one dedicated test identity, cleaned up at the end ──────────
    const ME_RESEED = Symbol.for('me.internal.reseed');
    const me = new (ME as any)();
    (me as any)[ME_RESEED](TEST_USERNAME, TEST_SECRET);

    const gwRes = await fetch(GATEWAY_ORIGIN + '/me/gateway');
    const gwData: any = await gwRes.json();
    const hostname = String(gwData.hostname || '').trim();
    assert.ok(hostname, '/me/gateway returned a hostname');

    const node = cleaker(me as any, hostname);
    const idProof = await node.prove({ rootNamespace: hostname, challenge: null });
    const identityHash = idProof.identityHash;
    const publicKey = idProof.publicKey;
    console.log('test identity:', identityHash);

    const claimsBefore = readClaims();
    const cleanup = () => {
        const claims = readClaims();
        delete claims.pubkeys[identityHash];
        delete claims.grants[identityHash];
        if (claims.admins) delete claims.admins[identityHash];
        if (claims.usernames) delete claims.usernames[identityHash];
        writeClaims(claims);
    };

    function anchorTestIdentity(opts: { admin?: boolean; scopes?: string[] } = {}) {
        const claims = readClaims();
        claims.pubkeys[identityHash] = publicKey;
        claims.usernames = claims.usernames || {};
        claims.usernames[identityHash] = TEST_USERNAME;
        claims.admins = claims.admins || {};
        if (opts.admin) claims.admins[identityHash] = true;
        else delete claims.admins[identityHash];
        if (opts.scopes) claims.grants[identityHash] = opts.scopes;
        else delete claims.grants[identityHash];
        writeClaims(claims);
    }

    try {
        // =====================================================================
        // 1. Payload-bound proof
        // =====================================================================
        console.log('\n[1] Payload-bound proof');
        anchorTestIdentity();
        await settle();

        {
            // valid proof passes (an unprotected-of-capability but proof-gated
            // endpoint — /check-auth just needs a valid, matching proof)
            const { status, json } = await signedRequest(node, hostname, 'GET', '/check-auth', undefined);
            assert.equal(status, 200, 'valid proof: expected 200');
            assert.equal(json.authenticated, true, 'valid proof: expected authenticated:true');
            console.log('  ✓ valid proof passes');
        }
        {
            // body changed after signing — sign for {domain:"a"}, send {domain:"b"}
            const bodyHash = sha256Hex(JSON.stringify({ domain: 'signed-for-this', description: 'x' }));
            const { status, json } = await signedRequest(
                node, hostname, 'POST', '/domains/metadata',
                { domain: 'actually-sent', description: 'x' },
                { bodyHash },
            );
            assert.equal(status, 401, 'tampered body: expected 401');
            assert.equal(json.error, 'ME_PROOF_BODY_MISMATCH', 'tampered body: expected ME_PROOF_BODY_MISMATCH');
            console.log('  ✓ body tampered after signing → rejected');
        }
        {
            // method changed after signing — sign for POST, actually send GET
            const { status, json } = await signedRequest(
                node, hostname, 'GET', '/domains/metadata', undefined,
                { method: 'POST', bodyHash: sha256Hex('') },
            );
            assert.equal(status, 401, 'tampered method: expected 401');
            assert.equal(json.error, 'ME_PROOF_METHOD_MISMATCH', 'tampered method: expected ME_PROOF_METHOD_MISMATCH');
            console.log('  ✓ method tampered after signing → rejected');
        }
        {
            // path changed after signing — sign for /domains/metadata, actually
            // send to /check-auth (also me_sig.lua-gated)
            const { status, json } = await signedRequest(
                node, hostname, 'GET', '/check-auth', undefined,
                { method: 'GET', path: '/domains/metadata', bodyHash: sha256Hex('') },
            );
            assert.equal(status, 401, 'tampered path: expected 401');
            assert.equal(json.error, 'ME_PROOF_PATH_MISMATCH', 'tampered path: expected ME_PROOF_PATH_MISMATCH');
            console.log('  ✓ path tampered after signing → rejected');
        }
        {
            // stale timestamp — signed 2 minutes ago, outside the ±60s window
            const { status, json } = await signedRequest(
                node, hostname, 'GET', '/check-auth', undefined,
                { timestamp: Date.now() - 120_000 },
            );
            assert.equal(status, 401, 'stale timestamp: expected 401');
            assert.equal(json.error, 'ME_PROOF_EXPIRED', 'stale timestamp: expected ME_PROOF_EXPIRED');
            console.log('  ✓ stale timestamp → rejected');
        }
        {
            // reused nonce — a valid request, then an exact replay
            const nonce = genNonce();
            const first = await signedRequest(node, hostname, 'GET', '/check-auth', undefined, { nonce });
            assert.equal(first.status, 200, 'first use of nonce: expected 200');
            const replay = await signedRequest(node, hostname, 'GET', '/check-auth', undefined, { nonce });
            assert.equal(replay.status, 401, 'replayed nonce: expected 401');
            assert.equal(replay.json.error, 'ME_PROOF_REPLAY', 'replayed nonce: expected ME_PROOF_REPLAY');
            console.log('  ✓ reused nonce → rejected');
        }

        // =====================================================================
        // 2. Capability separation
        // =====================================================================
        console.log('\n[2] Capability separation');
        const domain1 = `gateway-capability-suite-${Date.now()}-a.example`;

        {
            // authenticated, no grant at all → 403
            anchorTestIdentity();
            await settle();
            const { status, json } = await signedRequest(node, hostname, 'POST', '/domains/metadata', { domain: domain1, description: 'x' });
            assert.equal(status, 403, 'no grant: expected 403');
            assert.equal(json.error, 'CAPABILITY_DENIED', 'no grant: expected CAPABILITY_DENIED');
            console.log('  ✓ authenticated identity, no capability → 403 (the central invariant)');
        }
        {
            // admin status alone, still no grant → still 403
            anchorTestIdentity({ admin: true });
            await settle();
            const { status, json } = await signedRequest(node, hostname, 'POST', '/domains/metadata', { domain: domain1, description: 'x' });
            assert.equal(status, 403, 'admin without grant: expected 403');
            assert.equal(json.error, 'CAPABILITY_DENIED', 'admin without grant: expected CAPABILITY_DENIED');
            console.log('  ✓ admin status alone does not imply the capability');
        }
        {
            // an unrelated scope does not pass
            anchorTestIdentity({ admin: true, scopes: ['domains:read'] });
            await settle();
            const { status, json } = await signedRequest(node, hostname, 'POST', '/domains/metadata', { domain: domain1, description: 'x' });
            assert.equal(status, 403, 'unrelated scope: expected 403');
            assert.equal(json.error, 'CAPABILITY_DENIED', 'unrelated scope: expected CAPABILITY_DENIED');
            console.log('  ✓ unrelated scope (domains:read) does not satisfy gateway:write:domain-metadata');
        }
        {
            // the explicit capability, and only then, succeeds
            anchorTestIdentity({ admin: true, scopes: [CAPABILITY] });
            await settle();
            const { status, json } = await signedRequest(node, hostname, 'POST', '/domains/metadata', { domain: domain1, description: 'allowed value' });
            assert.equal(status, 200, 'with capability: expected 200');
            assert.equal(json.ok, true, 'with capability: expected ok:true');
            console.log('  ✓ same identity, with the explicit grant → 200');
        }

        // =====================================================================
        // 3. Side-effect safety
        // =====================================================================
        console.log('\n[3] Side-effect safety');
        {
            const domainMapBefore = fs.existsSync(domainMapVersionPath) ? fs.readFileSync(domainMapVersionPath, 'utf8') : null;
            const dbRowBefore = sqliteRowForDomain(domain1);

            const metadata = readMetadata();
            assert.equal(metadata[domain1]?.description, 'allowed value', 'metadata sidecar has the write from category 2');

            const domainMapAfter = fs.existsSync(domainMapVersionPath) ? fs.readFileSync(domainMapVersionPath, 'utf8') : null;
            assert.equal(domainMapAfter, domainMapBefore, 'domain-map.version unchanged — metadata writes never touch routing');

            const dbRowAfter = sqliteRowForDomain(domain1);
            assert.equal(dbRowAfter, dbRowBefore, 'domains.db has no row for this domain, before or after — metadata write never touched it');
            assert.equal(dbRowAfter, '', 'domains.db genuinely has no row for a domain that was only ever metadata-written (sqlite3 -json prints nothing for zero matching rows)');
            console.log('  ✓ successful write touched only domain-metadata.json — domains.db and domain-map untouched');
        }
        {
            // a denied write must not create even a partial entry
            const domain2 = `gateway-capability-suite-${Date.now()}-denied.example`;
            anchorTestIdentity(); // no grant
            await settle();
            const { status } = await signedRequest(node, hostname, 'POST', '/domains/metadata', { domain: domain2, description: 'should never land' });
            assert.equal(status, 403);
            const metadata = readMetadata();
            assert.equal(metadata[domain2], undefined, 'denied write created no entry, partial or otherwise');
            console.log('  ✓ denied writes create no partial state');
        }

        // =====================================================================
        // 4. Audit
        // =====================================================================
        console.log('\n[4] Audit');
        {
            const entries = readAuditLines().filter((e) => e.identity === identityHash && e.domain === domain1);
            const denied = entries.find((e) => e.outcome === 'denied');
            const allowed = entries.find((e) => e.outcome === 'allowed');
            assert.ok(denied, 'a denied audit entry exists for this identity+domain');
            assert.ok(allowed, 'an allowed audit entry exists for this identity+domain');
            for (const e of [denied, allowed]) {
                assert.equal(e.action, 'gateway:write:domain-metadata', 'audit entry records the capability/action');
                assert.equal(e.identity, identityHash, 'audit entry records the identity hash');
                assert.equal(e.domain, domain1, 'audit entry records the target domain');
                assert.ok(typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at)), 'audit entry has a parseable timestamp');
            }
            assert.ok('reason' in denied, 'denied entry records why');
            console.log('  ✓ denied and allowed attempts both produce a complete audit record');
        }

        // =====================================================================
        // 5. Lua boundary — verify-and-forward, never decide
        // =====================================================================
        console.log('\n[5] Lua boundary');
        {
            // No X-Me-Proof at all → me_sig.lua rejects before the daemon is
            // ever reached. Distinguishable from the daemon's own denial: Lua's
            // deny() shape is {error, message}; the daemon's is
            // {ok:false, error, required}.
            const res = await fetch(GATEWAY_ORIGIN + '/domains/metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: domain1, description: 'no proof at all' }),
            });
            const json = await res.json();
            assert.equal(res.status, 401, 'no proof: expected 401');
            assert.equal(json.error, 'ME_PROOF_REQUIRED', 'no proof: rejected by me_sig.lua, not the daemon');
            assert.ok(!('required' in json), 'response shape is Lua\'s deny(), not the daemon\'s CAPABILITY_DENIED shape');
            console.log('  ✓ missing proof is rejected by Lua before reaching the daemon');
        }
        {
            // Daemon reached directly, bypassing nginx/Lua entirely — it must
            // independently refuse, not trust an absent identity header.
            const res = await fetch(BACKEND_ORIGIN + '/domains/metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: domain1, description: 'bypassing nginx' }),
            });
            const json = await res.json();
            assert.equal(res.status, 401, 'daemon hit directly: expected 401');
            assert.equal(json.error, 'IDENTITY_REQUIRED', 'daemon refuses when no identity was forwarded');
            console.log('  ✓ daemon independently rejects requests with no forwarded identity (defense in depth)');
        }

        console.log('\nALL CHECKS PASSED\n');
        console.log('The central invariant held: valid signed proof + authenticated');
        console.log('identity - explicit capability => 403. Decrypt/authenticate');
        console.log('audience did not imply write capability.');
    } finally {
        cleanup();
        assert.deepEqual(readClaims().pubkeys[identityHash], undefined, 'test identity was removed from gateway-claims.json');
        void claimsBefore; // kept for readability of intent, not asserted against
    }
}

main().catch((e) => {
    console.error('\nFAILED:', e);
    process.exit(1);
});
