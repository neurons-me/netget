-- gateway_identity.lua
-- Returns gateway identity: IP, port, scheme, bootstrapped state.
-- Reads gateway-claims.json — never calls .me at runtime.
-- loopback-only: nginx server_name local.netget enforces this at the network level.

local cjson = require "cjson.safe"

local function getNetgetDataDir()
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return os.getenv("HOME") .. "/.get"
end

local claimsPath = getNetgetDataDir() .. "/runtime/gateway-claims.json"

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

-- Parse /sbin/ifconfig output to find the first non-loopback, non-link-local IPv4.
local function get_local_ip()
  local handle = io.popen("/sbin/ifconfig 2>/dev/null")
  if not handle then return nil end
  local output = handle:read("*a")
  handle:close()
  if not output or output == "" then return nil end
  for ip in output:gmatch("inet%s+(%d+%.%d+%.%d+%.%d+)") do
    if ip ~= "127.0.0.1" and not ip:match("^169%.254%.") then
      return ip
    end
  end
  return nil
end

ngx.header["Content-Type"] = "application/json; charset=utf-8"

local raw = read_file(claimsPath)
local bootstrapped = false

if raw and raw ~= "" then
  local claims = cjson.decode(raw)
  if claims and type(claims) == "table" then
    bootstrapped = claims.owner ~= nil and claims.owner ~= cjson.null
  end
end

local ip     = get_local_ip()
local scheme = "https"
local port   = 443

ngx.say(cjson.encode({
  ip           = ip or cjson.null,
  port         = port,
  scheme       = scheme,
  bootstrapped = bootstrapped,
}))
