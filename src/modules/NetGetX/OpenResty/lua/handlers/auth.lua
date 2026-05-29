-- auth.lua - NetGet gateway authentication.
--
-- Actions are dispatched with the $auth_action nginx variable:
--   check_auth     GET  /check-auth       Verify X-Me-Proof header (stateless)
--   challenge      GET  /me/challenge     Issue one-time nonce for .me proof
--   me_auth        POST /me/auth          Verify .me proof or legacy hash — no cookie
--   logout         POST /logout           Stateless no-op
--   gateway_info   GET  /me/gateway       Return physical hostname
--   gateway_claims GET  /me/claims        Return owner/admin list
--
-- Auth model (stateless "sello digital"):
--   .me / Cleaker derives an identity locally from a seed.
--   NetGet stores only the anchored identityHash and Ed25519 public key.
--   Browser signs a one-time challenge via X-Me-Proof and sends only the proof.
--   No cookies. No sessions. No "remember me". Identity lives in memory only
--   while Cleaker is open — closing it IS the logout.

local cjson = require "cjson.safe"
local ffi   = require "ffi"

local NONCE_TTL        = 120
local PROOF_MAX_AGE_MS = 5 * 60 * 1000

-- OpenSSL Ed25519 via ffi.C — OpenResty loads libcrypto with RTLD_GLOBAL so
-- all symbols live in the global namespace. pcall guards duplicate cdef when
-- me_sig.lua ran first in this worker.
pcall(ffi.cdef, [[
typedef struct evp_pkey_st      EVP_PKEY;
typedef struct evp_md_ctx_st    EVP_MD_CTX;
typedef struct engine_st        ENGINE;
EVP_MD_CTX *EVP_MD_CTX_new(void);
void         EVP_MD_CTX_free(EVP_MD_CTX *ctx);
EVP_PKEY    *EVP_PKEY_new_raw_public_key(int type, ENGINE *e,
                 const unsigned char *key, size_t keylen);
void         EVP_PKEY_free(EVP_PKEY *key);
int          EVP_DigestVerifyInit(EVP_MD_CTX *ctx, void *pctx,
                 const void *type, ENGINE *e, EVP_PKEY *pkey);
int          EVP_DigestVerify(EVP_MD_CTX *ctx,
                 const unsigned char *sigret, size_t siglen,
                 const unsigned char *tbs,    size_t tbslen);
]])

local crypto = ffi.C
local EVP_PKEY_ED25519 = 1087

local function get_ed25519_nid()
  return EVP_PKEY_ED25519
end

-- Claims file path ----------------------------------------------------------

local function get_claims_path()
  local var_dir = ngx.var.NETGET_DATA_DIR
  if var_dir and var_dir ~= "" then
    return var_dir .. "/runtime/gateway-claims.json"
  end
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then
    return env_dir .. "/runtime/gateway-claims.json"
  end
  return (os.getenv("HOME") or "") .. "/.get/runtime/gateway-claims.json"
end

-- Claims cache --------------------------------------------------------------

local claims_cache = nil
local claims_version = nil

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function trim(s)
  return (s or ""):match("^%s*(.-)%s*$")
end

local function load_claims()
  local claims_path = get_claims_path()
  local version_path = claims_path:gsub("%.json$", ".version")
  local version = trim(read_file(version_path) or "")

  if claims_cache and version ~= "" and version == claims_version then
    return claims_cache
  end

  local raw = read_file(claims_path)
  if not raw or raw == "" then return nil end

  local claims = cjson.decode(raw)
  if type(claims) ~= "table" then return nil end

  claims_cache = claims
  claims_version = version
  return claims
end

-- Response helpers ----------------------------------------------------------

local function set_json()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function respond(status, payload)
  set_json()
  ngx.status = status
  ngx.say(cjson.encode(payload or {}))
end

local function read_body_json()
  ngx.req.read_body()
  local raw = ngx.req.get_body_data()
  if not raw then return nil end
  local obj = cjson.decode(raw)
  return type(obj) == "table" and obj or nil
end

local function is_valid_hash(value)
  return type(value) == "string"
    and #value == 64
    and value:match("^[0-9a-f]+$") ~= nil
end

local function is_valid_base64url(value)
  return type(value) == "string"
    and #value > 0
    and value:match("^[A-Za-z0-9_-]+$") ~= nil
end

local function shallow_copy_array(value)
  local out = {}
  if type(value) ~= "table" then return out end
  for _, item in ipairs(value) do
    table.insert(out, item)
  end
  return out
end

-- Session -------------------------------------------------------------------
-- Stateless: no cookies, no JWT. Return identity info as JSON.
-- The browser holds this in React state for as long as Cleaker is open.

local function issue_session(claims, identity_hash, public_key)
  local grants = type(claims.grants) == "table" and claims.grants or {}
  local scopes = shallow_copy_array(grants[identity_hash])
  local scope_count = #scopes
  respond(ngx.HTTP_OK, {
    success      = true,
    identityHash = identity_hash,
    publicKey    = public_key or cjson.null,
    gatewayId    = claims.gatewayId or "",
    isOwner      = (claims.owner == identity_hash),
    scopes       = scope_count > 0 and scopes or cjson.empty_array,
  })
end

-- Base64url / JSON canonicalization ----------------------------------------

local function base64url_decode(value)
  if not is_valid_base64url(value) then return nil end
  local normalized = value:gsub("-", "+"):gsub("_", "/")
  local remainder = #normalized % 4
  if remainder == 1 then return nil end
  if remainder == 2 then
    normalized = normalized .. "=="
  elseif remainder == 3 then
    normalized = normalized .. "="
  end
  return ngx.decode_base64(normalized)
end

local function is_array(value)
  if type(value) ~= "table" then return false end
  local max = 0
  local count = 0
  for key, _ in pairs(value) do
    if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
      return false
    end
    if key > max then max = key end
    count = count + 1
  end
  return max == count
end

local function normalize_proof_message(value)
  if value == cjson.null then return "null" end

  local kind = type(value)
  if kind == "nil" then return "null" end
  if kind == "string" or kind == "number" or kind == "boolean" then
    return cjson.encode(value)
  end

  if kind ~= "table" then return "null" end

  if is_array(value) then
    local parts = {}
    for i = 1, #value do
      table.insert(parts, normalize_proof_message(value[i]))
    end
    return "[" .. table.concat(parts, ",") .. "]"
  end

  local keys = {}
  for key, _ in pairs(value) do
    table.insert(keys, tostring(key))
  end
  table.sort(keys)

  local parts = {}
  for _, key in ipairs(keys) do
    table.insert(parts, cjson.encode(key) .. ":" .. normalize_proof_message(value[key]))
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function parse_proof_payload(proof)
  if type(proof) ~= "table" then
    return nil, "PROOF_REQUIRED"
  end

  local message = tostring(proof.message or "")
  if message == "" then
    return nil, "PROOF_MESSAGE_REQUIRED"
  end

  local payload = cjson.decode(message)
  if type(payload) ~= "table" then
    return nil, "PROOF_MESSAGE_INVALID"
  end

  if normalize_proof_message(payload) ~= message then
    return nil, "PROOF_MESSAGE_NOT_CANONICAL"
  end

  local identity_hash = tostring(payload.identityHash or "")
  local expression = tostring(payload.expression or "")
  local namespace = tostring(payload.namespace or "")
  local root_namespace = tostring(payload.rootNamespace or "")
  local challenge = payload.challenge == cjson.null and nil or tostring(payload.challenge or "")
  local timestamp = tonumber(payload.timestamp or 0)

  if not is_valid_hash(identity_hash) then
    return nil, "IDENTITY_HASH_INVALID"
  end
  if expression == "" or namespace == "" or root_namespace == "" then
    return nil, "PROOF_NAMESPACE_INVALID"
  end
  if not challenge or challenge == "" then
    return nil, "PROOF_CHALLENGE_REQUIRED"
  end
  if not timestamp or timestamp <= 0 then
    return nil, "PROOF_TIMESTAMP_INVALID"
  end

  if proof.identityHash and tostring(proof.identityHash) ~= identity_hash then
    return nil, "PROOF_IDENTITY_MISMATCH"
  end
  if proof.expression and tostring(proof.expression) ~= expression then
    return nil, "PROOF_EXPRESSION_MISMATCH"
  end
  if proof.namespace and tostring(proof.namespace) ~= namespace then
    return nil, "PROOF_NAMESPACE_MISMATCH"
  end
  if proof.rootNamespace and tostring(proof.rootNamespace) ~= root_namespace then
    return nil, "PROOF_ROOT_NAMESPACE_MISMATCH"
  end
  if proof.challenge and tostring(proof.challenge) ~= challenge then
    return nil, "PROOF_CHALLENGE_MISMATCH"
  end
  if proof.timestamp and tonumber(proof.timestamp) ~= timestamp then
    return nil, "PROOF_TIMESTAMP_MISMATCH"
  end

  return {
    identityHash  = identity_hash,
    expression    = expression,
    namespace     = namespace,
    rootNamespace = root_namespace,
    challenge     = challenge,
    timestamp     = timestamp,
    publicKey     = tostring(proof.publicKey  or ""),
    signature     = tostring(proof.signature  or ""),
    message       = message,
  }, nil
end

-- Nonces ---------------------------------------------------------------------

local function nonce_dict()
  return ngx.shared.gateway_nonces
end

local function random_hex(bytes)
  local f = io.open("/dev/urandom", "rb")
  if not f then return nil end
  local data = f:read(bytes)
  f:close()
  if not data or #data ~= bytes then return nil end
  return (data:gsub(".", function(c)
    return string.format("%02x", string.byte(c))
  end))
end

local function challenge()
  local dict = nonce_dict()
  if not dict then
    respond(ngx.HTTP_INTERNAL_SERVER_ERROR, {
      success = false,
      error   = "NONCE_STORE_UNAVAILABLE",
      message = "gateway_nonces shared dictionary is not configured.",
    })
    return
  end

  local nonce = random_hex(32)
  if not nonce then
    respond(ngx.HTTP_INTERNAL_SERVER_ERROR, {
      success = false,
      error   = "NONCE_RANDOM_FAILED",
      message = "Could not read secure random bytes.",
    })
    return
  end

  dict:set(nonce, true, NONCE_TTL)
  respond(ngx.HTTP_OK, {
    success    = true,
    nonce      = nonce,
    expiresIn  = NONCE_TTL,
    expires_in = NONCE_TTL,
  })
end

local function consume_nonce(nonce)
  local dict = nonce_dict()
  if not dict then
    return false, "NONCE_STORE_UNAVAILABLE"
  end
  if type(nonce) ~= "string" or not nonce:match("^[0-9a-f]+$") or #nonce ~= 64 then
    return false, "NONCE_INVALID"
  end
  if not dict:get(nonce) then
    return false, "NONCE_INVALID"
  end
  dict:delete(nonce)
  return true, nil
end

-- Ed25519 --------------------------------------------------------------------

local function verify_ed25519_signature(public_key_b64url, message, signature_b64url)
  local public_key = base64url_decode(public_key_b64url)
  local signature  = base64url_decode(signature_b64url)

  if not public_key or #public_key ~= 32 then return false, "PUBLIC_KEY_INVALID" end
  if not signature  or #signature  ~= 64 then return false, "SIGNATURE_INVALID"  end

  local nid = get_ed25519_nid()

  local pub_buf = ffi.new("unsigned char[?]", #public_key)
  local sig_buf = ffi.new("unsigned char[?]", #signature)
  local msg_buf = ffi.new("unsigned char[?]", #message)
  ffi.copy(pub_buf, public_key, #public_key)
  ffi.copy(sig_buf, signature,  #signature)
  ffi.copy(msg_buf, message,    #message)

  local pkey = crypto.EVP_PKEY_new_raw_public_key(nid, nil, pub_buf, #public_key)
  if pkey == nil then return false, "PUBLIC_KEY_IMPORT_FAILED" end

  local ctx = crypto.EVP_MD_CTX_new()
  if ctx == nil then
    crypto.EVP_PKEY_free(pkey)
    return false, "VERIFY_CONTEXT_FAILED"
  end

  local ok = false
  if crypto.EVP_DigestVerifyInit(ctx, nil, nil, nil, pkey) == 1 then
    ok = crypto.EVP_DigestVerify(ctx, sig_buf, #signature, msg_buf, #message) == 1
  end

  crypto.EVP_MD_CTX_free(ctx)
  crypto.EVP_PKEY_free(pkey)

  return ok, ok and nil or "SIGNATURE_INVALID"
end

-- Actions --------------------------------------------------------------------

-- check_auth: reads identity set by me_sig.lua (access_by_lua_file).
-- me_sig.lua verifies X-Me-Proof and sets ngx.ctx.me_identity / me_scopes / me_is_owner.
local function check_auth()
  set_json()
  local identity_hash = ngx.ctx.me_identity
  if not identity_hash or identity_hash == "" then
    ngx.say(cjson.encode({ authenticated = false }))
    return
  end
  local claims = load_claims()
  ngx.say(cjson.encode({
    authenticated = true,
    identityHash  = identity_hash,
    isOwner       = ngx.ctx.me_is_owner or false,
    scopes        = ngx.ctx.me_scopes   or cjson.empty_array,
    gatewayId     = claims and claims.gatewayId or "",
  }))
end

local function gateway_info()
  local claims = load_claims()
  set_json()
  ngx.say(cjson.encode({
    hostname  = ngx.var.hostname or os.getenv("HOSTNAME") or "unknown",
    gatewayId = (claims and claims.gatewayId) or ngx.var.hostname or "unknown",
    claimed   = claims ~= nil and claims.owner ~= nil and claims.owner ~= cjson.null,
  }))
end

local function gateway_claims()
  local claims = load_claims()
  set_json()
  if not claims or not claims.owner or claims.owner == cjson.null then
    ngx.say(cjson.encode({ claimed = false, owner = cjson.null, admins = cjson.empty_array, gatewayId = "" }))
    return
  end
  local usernames = type(claims.usernames) == "table" and claims.usernames or {}
  local function fmt(hash)
    return { hash = hash, short = hash:sub(1, 10), username = usernames[hash] or cjson.null }
  end
  local admin_list = {}
  for hash, _ in pairs(type(claims.admins) == "table" and claims.admins or {}) do
    if hash ~= claims.owner then table.insert(admin_list, fmt(hash)) end
  end
  local admin_count = #admin_list
  ngx.say(cjson.encode({
    claimed   = true,
    gatewayId = claims.gatewayId or "",
    owner     = fmt(claims.owner),
    admins    = admin_count > 0 and admin_list or cjson.empty_array,
    total     = 1 + admin_count,
  }))
end

local function legacy_hash_auth(body)
  local hash = tostring(body.identityHash or "")
  if not is_valid_hash(hash) then
    respond(ngx.HTTP_BAD_REQUEST, {
      success = false,
      error   = "INVALID_IDENTITY_HASH",
      message = "identityHash must be a 64-char lowercase hex string.",
    })
    return
  end

  local claims = load_claims()
  if not claims then
    respond(ngx.HTTP_SERVICE_UNAVAILABLE, {
      success = false,
      error   = "GATEWAY_NOT_BOOTSTRAPPED",
      message = "This gateway has no owner. Run `netget claim` to set one.",
    })
    return
  end

  local admins  = type(claims.admins)  == "table" and claims.admins  or {}
  local pubkeys = type(claims.pubkeys) == "table" and claims.pubkeys or {}

  if admins[hash] ~= true then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = "IDENTITY_NOT_AUTHORISED",
      message = "Identity not found in gateway admins.",
    })
    return
  end

  if pubkeys[hash] then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = "PROOF_REQUIRED",
      message = "This identity is anchored with an Ed25519 proof key.",
    })
    return
  end

  issue_session(claims, hash, nil)
end

local function proof_auth(body)
  local proof = body.proof
  local payload, parse_error = parse_proof_payload(proof)
  if not payload then
    respond(ngx.HTTP_BAD_REQUEST, {
      success = false,
      error   = parse_error or "PROOF_INVALID",
    })
    return
  end

  local nonce_ok, nonce_error = consume_nonce(payload.challenge)
  if not nonce_ok then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = nonce_error or "NONCE_INVALID",
      message = "Challenge nonce is invalid, expired, or already used.",
    })
    return
  end

  local age = math.abs((ngx.now() * 1000) - payload.timestamp)
  if age > PROOF_MAX_AGE_MS then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = "PROOF_TIMESTAMP_INVALID",
      message = "Proof timestamp is outside the allowed window.",
    })
    return
  end

  local claims = load_claims()
  if not claims then
    respond(ngx.HTTP_SERVICE_UNAVAILABLE, {
      success = false,
      error   = "GATEWAY_NOT_BOOTSTRAPPED",
      message = "This gateway has no owner. Run `netget claim` to set one.",
    })
    return
  end

  local admins           = type(claims.admins)  == "table" and claims.admins  or {}
  local pubkeys          = type(claims.pubkeys) == "table" and claims.pubkeys or {}
  local stored_public_key = pubkeys[payload.identityHash]

  if admins[payload.identityHash] ~= true then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = "IDENTITY_NOT_AUTHORISED",
      message = "Identity not found in gateway admins.",
    })
    return
  end

  if type(stored_public_key) ~= "string" or stored_public_key == "" then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = "PROOF_KEY_NOT_ANCHORED",
      message = "Run `netget claim` again to store this identity proof key.",
    })
    return
  end

  if stored_public_key ~= payload.publicKey then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = "PUBLIC_KEY_MISMATCH",
      message = "Proof public key does not match the key anchored on this gateway.",
    })
    return
  end

  local verified, verify_error = verify_ed25519_signature(
    payload.publicKey,
    payload.message,
    payload.signature
  )

  if not verified then
    respond(ngx.HTTP_UNAUTHORIZED, {
      success = false,
      error   = verify_error or "SIGNATURE_INVALID",
      message = "Ed25519 signature did not verify.",
    })
    return
  end

  issue_session(claims, payload.identityHash, payload.publicKey)
end

local function me_auth()
  local body = read_body_json() or {}
  if type(body.proof) == "table" then
    proof_auth(body)
    return
  end
  legacy_hash_auth(body)
end

local function logout()
  -- Stateless: no server-side session to clear.
  -- Identity lives in browser memory only; closing Cleaker IS the logout.
  respond(ngx.HTTP_OK, { success = true, message = "Logged out." })
end

-- Dispatch -------------------------------------------------------------------

local action = ngx.var.auth_action
if action == "check_auth" then
  check_auth()
elseif action == "challenge" then
  challenge()
elseif action == "me_auth" then
  me_auth()
elseif action == "logout" then
  logout()
elseif action == "gateway_info" then
  gateway_info()
elseif action == "gateway_claims" then
  gateway_claims()
else
  respond(ngx.HTTP_NOT_FOUND, {})
end
