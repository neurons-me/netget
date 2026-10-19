local cjson = require "cjson.safe"
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

local function healthcheck()
  set_json()
  ngx.say(cjson.encode({
    status = "ok",
    timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    service = "NetGet Instance",
    version = "2.56"
  }))
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

-- RFC1918 / loopback / link-local: who is on this machine or its own LAN. The NIC's private address is a detail of the
-- infrastructure; a peer from the internet does not get it.
local function is_private_ipv4(ip)
  if type(ip) ~= "string" then return false end
  local a, b = ip:match("^(%d+)%.(%d+)%.%d+%.%d+$")
  a, b = tonumber(a), tonumber(b)
  if not a then return false end
  return a == 10 or a == 127 or (a == 192 and b == 168) or (a == 172 and b >= 16 and b <= 31) or (a == 169 and b == 254)
end

local function is_local_peer()
  local ip = ngx.var.remote_addr or ""
  return ip == "::1" or ip == "unix:" or is_private_ipv4(ip)
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
  local detection = nil
  local f = io.open(netgetDir .. "/xConfig.json", "r")
  if f then
    local raw = f:read("*a")
    f:close()
    local ok, parsed = pcall(cjson.decode, raw)
    if ok and type(parsed) == "table" then
      if looks_like_ipv4(parsed.publicIP) then publicIP = parsed.publicIP end
      if looks_like_ipv4(parsed.localIP) then localIP = parsed.localIP end
      -- when/how publicIP was last checked (written by modules/utils/networkIdentity.ts). Only these fields leave.
      local d = parsed.publicIPDetection
      if type(d) == "table" and (d.state == "detected" or d.state == "pending" or d.state == "failed") then
        detection = { state = d.state, observedAt = d.observedAt, checkedAt = d.checkedAt, source = d.source }
      end
    end
  end
  -- Fall back to what this connection itself arrived on if xConfig had nothing usable -- still real, just less stable
  -- than the stored value.
  if localIP == "" and looks_like_ipv4(ngx.var.server_addr) then
    localIP = ngx.var.server_addr
  end
  -- Read only, and the private address is for local peers only: it is omitted (not blanked) for anyone else.
  local out = { success = true, publicIP = publicIP }
  if detection then out.publicIPDetection = detection end
  if is_local_peer() and localIP ~= "" then out.localIP = localIP end
  ngx.say(cjson.encode(out))
end

local function port_info()
  set_json()
  local backendPort = os.getenv("LOCAL_BACKEND_PORT") or "3000"
  ngx.say(cjson.encode({ success = true, port = backendPort }))
end

local action = ngx.var.misc_action
if action == "healthcheck" then
  return healthcheck()
elseif action == "ip_info" then
  return ip_info()
elseif action == "port_info" then
  return port_info()
else
  set_json()
  ngx.status = 404
  ngx.say("{}")
end
