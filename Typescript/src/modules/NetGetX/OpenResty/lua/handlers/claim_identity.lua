-- claim_identity.lua
-- POST /me/claim — register a .me identity on this gateway.
-- No monad required. The seed never leaves the browser.
--
-- Model:
--   Gateway unclaimed → first valid proof becomes owner/admin.
--   Gateway claimed   → later valid proofs are anchored as registered identities.
--                       They are not admins unless a separate owner grant adds scopes.
--
-- Request body (JSON):
--   { "proof": "<base64url(JSON.stringify(MEProofResult))>", "username": "suign" }
--
-- The proof challenge must encode the request fingerprint:
--   canonicalJson({ method: "POST", nonce: "...", path: "/me/claim", timestamp: <ms> })
--
-- On success: delegates the state mutation to the Node backend, which writes
-- the .me semantic ledger first and then materializes gateway-claims.json for
-- Lua's hot path. This Lua handler verifies proof only; it is not a ledger.

local cjson = require "cjson.safe"
local ffi   = require "ffi"

-- ── Ed25519 via OpenSSL 3 FFI ──────────────────────────────────────────────────

local _lib = nil

local function libcrypto()
  if _lib then return _lib end
  -- Use pcall so duplicate declarations (if me_sig.lua loaded first) are ignored.
  pcall(ffi.cdef, [[
    typedef struct evp_pkey_st     EVP_PKEY;
    typedef struct evp_md_ctx_st   EVP_MD_CTX;
    typedef struct engine_st       ENGINE;
    typedef struct evp_md_st       EVP_MD;
    typedef struct evp_pkey_ctx_st EVP_PKEY_CTX;
    EVP_PKEY *EVP_PKEY_new_raw_public_key(
        int type, ENGINE *e, const unsigned char *key, size_t keylen);
    void EVP_PKEY_free(EVP_PKEY *key);
    EVP_MD_CTX *EVP_MD_CTX_new(void);
    void        EVP_MD_CTX_free(EVP_MD_CTX *ctx);
    int EVP_DigestVerifyInit(
        EVP_MD_CTX *ctx, EVP_PKEY_CTX **pctx,
        const EVP_MD *type, ENGINE *e, EVP_PKEY *pkey);
    int EVP_DigestVerify(
        EVP_MD_CTX *ctx,
        const unsigned char *sigret, size_t siglen,
        const unsigned char *tbs,    size_t tbslen);
  ]])
  _lib = ffi.load("/opt/homebrew/opt/openresty-openssl3/lib/libcrypto.3.dylib")
  return _lib
end

local EVP_PKEY_ED25519 = 1087

local function b64url_decode(s)
  if type(s) ~= "string" or s == "" then return nil end
  s = s:gsub("%-", "+"):gsub("_", "/")
  local pad = (4 - #s % 4) % 4
  if pad ~= 4 then s = s .. string.rep("=", pad) end
  return ngx.decode_base64(s)
end

local function verify_ed25519(pub_b64url, message_str, sig_b64url)
  local ok, lib = pcall(libcrypto)
  if not ok or not lib then return false end
  local pub_raw = b64url_decode(pub_b64url)
  local sig_raw = b64url_decode(sig_b64url)
  if not pub_raw or #pub_raw ~= 32 then return false end
  if not sig_raw or #sig_raw ~= 64 then return false end
  if not message_str or #message_str == 0 then return false end
  local pub_arr = ffi.new("unsigned char[32]")
  local sig_arr = ffi.new("unsigned char[64]")
  local msg_arr = ffi.new("unsigned char[?]", #message_str)
  ffi.copy(pub_arr, pub_raw, 32)
  ffi.copy(sig_arr, sig_raw, 64)
  ffi.copy(msg_arr, message_str, #message_str)
  local pkey = lib.EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nil, pub_arr, 32)
  if pkey == nil then return false end
  local mctx = lib.EVP_MD_CTX_new()
  if mctx == nil then lib.EVP_PKEY_free(pkey); return false end
  local rc = lib.EVP_DigestVerifyInit(mctx, nil, nil, nil, pkey)
  if rc ~= 1 then lib.EVP_MD_CTX_free(mctx); lib.EVP_PKEY_free(pkey); return false end
  rc = lib.EVP_DigestVerify(mctx, sig_arr, 64, msg_arr, #message_str)
  lib.EVP_MD_CTX_free(mctx)
  lib.EVP_PKEY_free(pkey)
  return rc == 1
end

-- ── Helpers ────────────────────────────────────────────────────────────────────

local TIMESTAMP_SKEW = 60   -- seconds
local NONCE_TTL      = 120  -- seconds

local function deny(status, code, msg)
  ngx.status = status
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
  ngx.say(cjson.encode({ success = false, error = code, message = msg }))
  ngx.exit(status)
end

local function is_valid_hash(v)
  return type(v) == "string" and #v == 64 and v:match("^[0-9a-f]+$") ~= nil
end

-- ── Main ───────────────────────────────────────────────────────────────────────

if ngx.req.get_method() ~= "POST" then
  deny(405, "METHOD_NOT_ALLOWED", "Use POST.")
end

ngx.req.read_body()
local raw_body = ngx.req.get_body_data()
if not raw_body or raw_body == "" then
  deny(400, "BODY_REQUIRED", "Request body is empty.")
end

local body = cjson.decode(raw_body)
if type(body) ~= "table" then
  deny(400, "BODY_INVALID", "Request body must be JSON.")
end

-- 1a. Optional username (handle to store alongside the hash).
local body_username = nil
if type(body.username) == "string" then
  local u = body.username:lower():match("^%s*(.-)%s*$")
  if u ~= "" then
    if #u < 3 or #u > 63 or not u:match("^[a-z0-9][a-z0-9%-]*[a-z0-9]$") then
      deny(400, "USERNAME_INVALID",
        "username must be one handle label: 3-63 lowercase letters, digits, or hyphen; no dots.")
    end
    body_username = u
  end
end

-- 1. Decode proof
local proof_json = b64url_decode(type(body.proof) == "string" and body.proof or "")
if not proof_json then
  deny(400, "PROOF_REQUIRED", "proof field must be base64url-encoded JSON.")
end

local proof = cjson.decode(proof_json)
if type(proof) ~= "table" then
  deny(400, "PROOF_INVALID", "Decoded proof is not a JSON object.")
end

local identity_hash = type(proof.identityHash) == "string" and proof.identityHash or ""
local public_key    = type(proof.publicKey)     == "string" and proof.publicKey    or ""
local signature     = type(proof.signature)     == "string" and proof.signature    or ""
local message_str   = type(proof.message)       == "string" and proof.message      or ""

if not is_valid_hash(identity_hash) then
  deny(400, "IDENTITY_HASH_INVALID", "identityHash must be 64 lowercase hex chars.")
end
if public_key == "" or signature == "" or message_str == "" then
  deny(400, "PROOF_INCOMPLETE", "proof must include publicKey, signature, and message.")
end

-- 2. Parse message → extract challenge
local msg_obj = cjson.decode(message_str)
if type(msg_obj) ~= "table" then
  deny(400, "PROOF_MESSAGE_INVALID", "proof.message is not valid JSON.")
end

local challenge_str = type(msg_obj.challenge) == "string" and msg_obj.challenge or ""
if challenge_str == "" then
  deny(400, "PROOF_CHALLENGE_MISSING", "proof.message.challenge is required.")
end

-- 3. Parse challenge → verify method/path/timestamp/nonce
local req = cjson.decode(challenge_str)
if type(req) ~= "table" then
  deny(400, "PROOF_CHALLENGE_INVALID", "proof.message.challenge is not valid JSON.")
end

local req_method    = type(req.method)    == "string" and req.method    or ""
local req_path      = type(req.path)      == "string" and req.path      or ""
local req_nonce     = type(req.nonce)     == "string" and req.nonce     or ""
local req_timestamp = type(req.timestamp) == "number" and req.timestamp or 0

if req_method:upper() ~= "POST" then
  deny(401, "PROOF_METHOD_MISMATCH", "Challenge method must be POST.")
end
if req_path ~= "/me/claim" then
  deny(401, "PROOF_PATH_MISMATCH", "Challenge path must be /me/claim.")
end

local now_s = ngx.time()
local ts_s  = math.floor(req_timestamp / 1000)
if math.abs(now_s - ts_s) > TIMESTAMP_SKEW then
  deny(401, "PROOF_EXPIRED", "Challenge timestamp is outside the ±" .. TIMESTAMP_SKEW .. "s window.")
end

if #req_nonce < 16 then
  deny(401, "PROOF_NONCE_INVALID", "Nonce is missing or too short.")
end

local dict = ngx.shared.gateway_nonces
if dict then
  if dict:get(req_nonce) then
    deny(401, "PROOF_REPLAY", "Nonce already used.")
  end
  dict:set(req_nonce, 1, NONCE_TTL)
end

-- 4. Verify Ed25519 signature
if not verify_ed25519(public_key, message_str, signature) then
  deny(401, "SIGNATURE_INVALID", "Ed25519 signature verification failed.")
end

-- 5. Delegate the verified claim to the ledger-backed backend.
local delegate_body = cjson.encode({
  identityHash = identity_hash,
  publicKey = public_key,
  username = body_username,
})

local upstream = ngx.location.capture("/__netget/internal/gateway-claim", {
  method = ngx.HTTP_POST,
  body = delegate_body,
})

if not upstream then
  deny(502, "CLAIMS_BACKEND_UNAVAILABLE", "Could not reach the gateway claims backend.")
end

ngx.status = upstream.status
ngx.header["Content-Type"] = "application/json; charset=utf-8"
ngx.say(upstream.body or "")
ngx.exit(upstream.status)
