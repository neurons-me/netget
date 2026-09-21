local cjson = require "cjson.safe"
local operator = require "lib.operator_access"
local function getNetgetDataDir()
  -- Prefer env, fallback to nginx var, finally default to ~/.get
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return os.getenv("HOME") .. "/.get"
end

local netgetDir = getNetgetDataDir()
local sqliteDatabasePath = netgetDir .. "/domains.db"

local function set_json()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function auth_context()
  return operator.jwt_payload()
end

local function healthcheck()
  set_json()
  ngx.say(cjson.encode({
    status = "ok",
    timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    service = "NetGet Instance",
    version = "2.56"
  }))
end

local function test_endpoint()
  set_json()
  local claims = auth_context()
  if not claims then
    ngx.status = 401
    ngx.say(cjson.encode({ error = "Unauthorized" }))
    return
  end
  ngx.say(cjson.encode({ message = "Test endpoint", identity = claims.username, context = claims }))
end

-- Very small IPv4-shape check -- xConfig.json's publicIP/localIP fields are
-- meant to hold real addresses (written by i_DefaultNetGetX.ts's init-time
-- getPublicIP()/getLocalIP() detection), but never trust an on-disk value
-- blindly: an older or manually-edited config could carry a placeholder
-- string instead of an address, and this handler must never forward one of
-- those as if it were real.
local function looks_like_ipv4(value)
  return type(value) == "string" and value:match("^%d+%.%d+%.%d+%.%d+$") ~= nil
end

local function ip_info()
  set_json()
  -- xConfig.json is the same file the Node-side config module
  -- (modules/NetGetX/config/xConfig.ts) reads and writes -- this handler
  -- previously never read it at all and returned a hardcoded "Not
  -- available" placeholder for publicIP unconditionally (a stale
  -- performance shortcut from before that detection existed). Reading the
  -- real file here means /ip-info answers the same way regardless of
  -- whether OpenResty (this handler) or the Node backend answers it.
  local publicIP = ""
  local localIP = ""
  local f = io.open(netgetDir .. "/xConfig.json", "r")
  if f then
    local raw = f:read("*a")
    f:close()
    local ok, parsed = pcall(cjson.decode, raw)
    if ok and type(parsed) == "table" then
      if looks_like_ipv4(parsed.publicIP) then publicIP = parsed.publicIP end
      if looks_like_ipv4(parsed.localIP) then localIP = parsed.localIP end
    end
  end
  -- Fall back to what this connection itself arrived on if xConfig had
  -- nothing usable -- still real, just less stable than the stored value.
  if localIP == "" and looks_like_ipv4(ngx.var.server_addr) then
    localIP = ngx.var.server_addr
  end
  ngx.say(cjson.encode({ success = true, publicIP = publicIP, localIP = localIP }))
end

local function port_info()
  set_json()
  local backendPort = os.getenv("LOCAL_BACKEND_PORT") or "3000"
  ngx.say(cjson.encode({ success = true, port = backendPort }))
end

local action = ngx.var.misc_action
if action == "healthcheck" then
  return healthcheck()
elseif action == "test_endpoint" then
  return test_endpoint()
elseif action == "ip_info" then
  return ip_info()
elseif action == "port_info" then
  return port_info()
else
  set_json()
  ngx.status = 404
  ngx.say("{}")
end
