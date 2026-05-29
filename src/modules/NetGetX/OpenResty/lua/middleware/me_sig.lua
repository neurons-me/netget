-- me_sig.lua — per-request Ed25519 signature verification
--
-- access_by_lua_file middleware.  Replaces jwt_cookie.lua on all protected routes.
--
-- Every request to a protected resource must carry:
--   X-Me-Proof: <base64url(JSON.stringify(MEProofResult))>
--
-- The proof is what cleaker(me, namespace).prove() returns.
-- The challenge inside the proof encodes the request itself:
--   JSON.stringify({ method, nonce, path, timestamp })  ← sorted keys
--
-- Verification steps:
--   1. Decode proof from header
--   2. Parse challenge → extract method, path, nonce, timestamp
--   3. method + path must match the actual request
--   4. timestamp must be within ±60s of server time
--   5. nonce must not have been used before (anti-replay)
--   6. proof.publicKey must match claims.pubkeys[identityHash]
--   7. Ed25519 signature must be valid
--
-- On success: sets ngx.ctx.me_identity, ngx.ctx.me_scopes, passes through.
-- Registered identities can authenticate with empty scopes; admin/owner status is
-- determined only by `claims.admins` / `claims.owner`.
-- On failure: returns 401 JSON.

local cjson = require "cjson.safe"
local ffi   = require "ffi"

-- ── FFI: OpenSSL 3 Ed25519 ────────────────────────────────────────────────────

local _libcrypto = nil

local function libcrypto()
  if _libcrypto then return _libcrypto end
  -- pcall guards against "attempt to redefine" when claim_identity.lua or
  -- auth.lua already ran ffi.cdef in the same worker process.
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
  _libcrypto = ffi.load(
    "/opt/homebrew/opt/openresty-openssl3/lib/libcrypto.3.dylib"
  )
  return _libcrypto
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
  if rc ~= 1 then
    lib.EVP_MD_CTX_free(mctx); lib.EVP_PKEY_free(pkey); return false
  end
  rc = lib.EVP_DigestVerify(mctx, sig_arr, 64, msg_arr, #message_str)
  lib.EVP_MD_CTX_free(mctx)
  lib.EVP_PKEY_free(pkey)
  return rc == 1
end

-- ── Claims loader (version-gated) ─────────────────────────────────────────────

local _claims_cache   = nil
local _claims_version = nil

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local d = f:read("*a"); f:close(); return d
end

local function get_claims_path()
  if ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR .. "/runtime/gateway-claims.json"
  end
  local env = os.getenv("NETGET_DATA_DIR")
  if env and env ~= "" then return env .. "/runtime/gateway-claims.json" end
  local home = os.getenv("HOME") or ""
  if home ~= "" then return home .. "/.get/runtime/gateway-claims.json" end
  return "/Users/" .. (os.getenv("USER") or "suign") .. "/.get/runtime/gateway-claims.json"
end

local function load_claims()
  local claims_path  = get_claims_path()
  local version_path = claims_path:gsub("%.json$", ".version")
  local ver = (read_file(version_path) or ""):match("^%s*(.-)%s*$")
  if _claims_cache and ver ~= "" and ver == _claims_version then
    return _claims_cache
  end
  local raw = read_file(claims_path)
  if not raw or raw == "" then return nil end
  local claims = cjson.decode(raw)
  if type(claims) ~= "table" then return nil end
  _claims_cache   = claims
  _claims_version = ver
  return claims
end

-- ── Nonce store (anti-replay) ─────────────────────────────────────────────────

local NONCE_TTL      = 120   -- seconds
local TIMESTAMP_SKEW = 60    -- seconds allowed clock drift

-- ── Main verification ─────────────────────────────────────────────────────────

local function deny(status, error_code, message)
  ngx.status = status
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
  ngx.say(cjson.encode({ error = error_code, message = message }))
  ngx.exit(status)
end

local function verify_request()
  -- 1. Read header
  local header = ngx.var.http_x_me_proof
  if not header or header == "" then
    deny(401, "ME_PROOF_REQUIRED",
      "Request must carry X-Me-Proof header. Cleaker session required.")
    return
  end

  -- 2. Decode base64url → JSON → proof object
  local proof_json = b64url_decode(header)
  if not proof_json then
    deny(401, "ME_PROOF_INVALID", "X-Me-Proof header is not valid base64url.")
    return
  end

  local proof = cjson.decode(proof_json)
  if type(proof) ~= "table" then
    deny(401, "ME_PROOF_INVALID", "X-Me-Proof payload is not a JSON object.")
    return
  end

  local hash       = type(proof.identityHash) == "string" and proof.identityHash or ""
  local message    = type(proof.message)       == "string" and proof.message       or ""
  local signature  = type(proof.signature)     == "string" and proof.signature     or ""
  local client_pub = type(proof.publicKey)     == "string" and proof.publicKey     or ""

  -- 3. Parse the signed message — must contain { challenge, ... }
  local msg_obj = cjson.decode(message)
  if type(msg_obj) ~= "table" then
    deny(401, "ME_PROOF_INVALID", "proof.message is not valid JSON.")
    return
  end

  -- 4. Challenge encodes the request: { method, nonce, path, timestamp }
  local challenge_str = type(msg_obj.challenge) == "string" and msg_obj.challenge or ""
  if challenge_str == "" then
    deny(401, "ME_PROOF_INVALID", "proof.message.challenge is missing.")
    return
  end

  local req = cjson.decode(challenge_str)
  if type(req) ~= "table" then
    deny(401, "ME_PROOF_INVALID", "proof.message.challenge is not valid JSON.")
    return
  end

  -- 5. method + path must match actual request
  local req_method = type(req.method) == "string" and req.method or ""
  local req_path   = type(req.path)   == "string" and req.path   or ""
  local req_nonce  = type(req.nonce)  == "string" and req.nonce  or ""
  local req_ts     = type(req.timestamp) == "number" and req.timestamp or 0

  if req_method:upper() ~= ngx.req.get_method():upper() then
    deny(401, "ME_PROOF_METHOD_MISMATCH",
      "Signed method does not match request method.")
    return
  end

  -- path check: compare without query string
  local actual_path = ngx.var.uri or ""
  if req_path ~= actual_path then
    deny(401, "ME_PROOF_PATH_MISMATCH",
      "Signed path '" .. req_path .. "' does not match request path '" .. actual_path .. "'.")
    return
  end

  -- 6. Timestamp freshness
  local now = ngx.time()
  local ts_seconds = math.floor(req_ts / 1000)   -- proof uses ms, nginx uses s
  if math.abs(now - ts_seconds) > TIMESTAMP_SKEW then
    deny(401, "ME_PROOF_EXPIRED",
      "Request timestamp is outside the ±" .. TIMESTAMP_SKEW .. "s window.")
    return
  end

  -- 7. Nonce anti-replay
  if req_nonce == "" or #req_nonce < 16 then
    deny(401, "ME_PROOF_INVALID", "Nonce is missing or too short.")
    return
  end

  local dict = ngx.shared.gateway_nonces
  if dict then
    if dict:get(req_nonce) then
      deny(401, "ME_PROOF_REPLAY",
        "Nonce already used. Each request must carry a fresh nonce.")
      return
    end
    dict:set(req_nonce, 1, NONCE_TTL)   -- mark as used
  end

  -- 8. Load claims
  local claims = load_claims()
  if not claims then
    deny(503, "GATEWAY_NOT_CLAIMED",
      "Gateway has no owner. Run `netget claim` to set one.")
    return
  end

  local pubkeys = type(claims.pubkeys) == "table" and claims.pubkeys or {}

  -- 9. Identity must be anchored on this gateway.
  if not (hash:match("^[0-9a-f]+$") and #hash == 64) then
    deny(401, "INVALID_IDENTITY_HASH", "identityHash must be 64 lowercase hex chars.")
    return
  end

  -- 10. Pubkey check
  local stored_pub = pubkeys[hash]
  if stored_pub and stored_pub ~= "" then
    if client_pub ~= stored_pub then
      deny(401, "PUBKEY_MISMATCH",
        "Proof public key does not match the claimed identity on this gateway.")
      return
    end
    -- 11. Ed25519 signature
    if not verify_ed25519(stored_pub, message, signature) then
      deny(401, "SIGNATURE_INVALID", "Ed25519 signature verification failed.")
      return
    end
  else
    deny(401, "PROOF_KEY_NOT_ANCHORED",
      "Identity proof key is not anchored on this gateway.")
    return
  end

  -- ✓ Verified — expose identity to downstream handlers via ngx.ctx
  ngx.ctx.me_identity = hash
  ngx.ctx.me_scopes   = claims.grants and claims.grants[hash] or {}
  ngx.ctx.me_is_owner = (claims.owner == hash)
  ngx.ctx.me_is_admin = type(claims.admins) == "table" and claims.admins[hash] == true
end

verify_request()
