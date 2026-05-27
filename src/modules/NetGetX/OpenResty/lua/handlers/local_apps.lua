-- local_apps.lua
-- Returns the live monad mesh for the local.netget GUI.
-- Reads apps.json and scrubs stale entries — mirrors scrub_dead_apps in apps.lua.
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

local appsPath = getNetgetDataDir() .. "/runtime/apps.json"

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

ngx.header["Content-Type"] = "application/json; charset=utf-8"

local raw = read_file(appsPath)
if not raw or raw == "" then
  ngx.say(cjson.encode({ apps = cjson.empty_array, count = 0, updatedAt = cjson.null }))
  return
end

local registry = cjson.decode(raw)
if not registry or type(registry) ~= "table" then
  ngx.say(cjson.encode({ apps = cjson.empty_array, count = 0, updatedAt = cjson.null }))
  return
end

local nowMs    = ngx.now() * 1000
local liveApps = {}

for _, app in pairs(registry.apps or {}) do
  local ttl      = tonumber(app.ttlMs)    or 45000
  local lastSeen = tonumber(app.lastSeenMs) or 0
  if lastSeen > 0 and (nowMs - lastSeen) <= ttl then
    table.insert(liveApps, app)
  end
end

ngx.say(cjson.encode({
  apps      = liveApps,
  count     = #liveApps,
  updatedAt = registry.updatedAt or cjson.null,
}))
