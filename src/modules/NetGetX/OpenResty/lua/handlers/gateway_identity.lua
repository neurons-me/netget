-- gateway_identity.lua
-- Returns the resolved gateway claims snapshot for the local.netget GUI.
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

local function count_keys(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n
end

ngx.header["Content-Type"] = "application/json; charset=utf-8"

local raw = read_file(claimsPath)
if not raw or raw == "" then
  ngx.say(cjson.encode({
    gatewayId   = os.getenv("HOSTNAME") or "unknown",
    owner       = cjson.null,
    bootstrapped = false,
    adminCount  = 0,
    scopes      = cjson.empty_array,
    version     = cjson.null,
    updatedAt   = cjson.null,
  }))
  return
end

local claims = cjson.decode(raw)
if not claims or type(claims) ~= "table" then
  ngx.status = 500
  ngx.say(cjson.encode({ error = "Failed to parse gateway-claims.json" }))
  return
end

local owner       = claims.owner
local admins      = type(claims.admins) == "table" and claims.admins or {}
local grants      = type(claims.grants) == "table" and claims.grants or {}
local ownerScopes = (owner and grants[owner]) or cjson.empty_array

ngx.say(cjson.encode({
  gatewayId    = claims.gatewayId or "unknown",
  owner        = owner or cjson.null,
  bootstrapped = owner ~= nil and owner ~= cjson.null,
  adminCount   = count_keys(admins),
  scopes       = ownerScopes,
  version      = claims.version  or cjson.null,
  updatedAt    = claims.updatedAt or cjson.null,
}))
