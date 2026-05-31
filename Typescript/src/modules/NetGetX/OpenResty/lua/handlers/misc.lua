local cjson = require "cjson.safe"
local jwt = require "resty.jwt"
local ck = require "resty.cookie"

local JWT_SECRET = os.getenv("JWT_SECRET") or "dev_secret"
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
  local cookie = ck:new()
  local token = cookie:get("token")
  if not token then return nil end
  local obj = jwt:verify(JWT_SECRET, token)
  if obj and obj.verified then
    return obj.payload
  end
  return nil
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

local function ip_info()
  set_json()
  -- Public IP discovery naive (external call disabled for performance); return placeholders.
  local publicIP = "Not available"
  local localIP = ngx.var.server_addr or "Not available"
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
