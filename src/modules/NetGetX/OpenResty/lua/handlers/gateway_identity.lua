-- gateway_identity.lua
-- Returns gateway identity: IP, port, scheme, bootstrapped state, and claims summary.
-- Reads gateway-claims.json — never calls .me at runtime.
-- loopback-only: nginx server_name local.netget enforces this at the network level.
--
-- Response shape (matches GatewayCardProps in netget.gui):
--   ip, port, scheme, bootstrapped,
--   gatewayId, owner (identityHash string | null),
--   adminCount, scopes, updatedAt

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

local raw    = read_file(claimsPath)
local claims = nil

if raw and raw ~= "" then
  local decoded = cjson.decode(raw)
  if decoded and type(decoded) == "table" then
    claims = decoded
  end
end

local bootstrapped = claims ~= nil and claims.owner ~= nil and claims.owner ~= cjson.null

-- Count admins (excluding owner so we report unique non-owner admin count).
local admin_count = 0
if claims and type(claims.admins) == "table" then
  for hash, _ in pairs(claims.admins) do
    if hash ~= claims.owner then
      admin_count = admin_count + 1
    end
  end
end

-- Owner scopes.
local scopes = cjson.empty_array
if claims and type(claims.grants) == "table" and type(claims.grants[claims.owner]) == "table" then
  scopes = claims.grants[claims.owner]
end

-- updatedAt as ISO 8601 string (claims stores it as epoch ms).
local updated_at = cjson.null
if claims and claims.updatedAt then
  local ts = tonumber(claims.updatedAt)
  if ts and ts > 0 then
    updated_at = os.date("!%Y-%m-%dT%H:%M:%SZ", math.floor(ts / 1000))
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
  gatewayId    = (claims and claims.gatewayId) or ngx.var.hostname or cjson.null,
  owner        = (claims and claims.owner)     or cjson.null,
  adminCount   = admin_count,
  scopes       = scopes,
  updatedAt    = updated_at,
}))
