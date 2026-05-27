-- surface_proxy.lua
-- Dynamic reverse proxy: routes hostname → monad endpoint.
-- Called via rewrite_by_lua_file in the namespace surface server block.
--
-- Algorithm:
--   1. Read apps.json (the live monad mesh registry)
--   2. Find the app whose hostname matches ngx.var.host (case-insensitive)
--   3. Set ngx.var.surface_proxy_target to its directEndpoint
--   4. nginx proxy_pass picks that up
--
-- If no matching monad is found → 502 with a descriptive message.

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

local host = (ngx.var.host or ""):lower()

-- Strip port from host header if present (e.g. "foo.local:443")
host = host:match("^([^:]+)") or host

local raw = read_file(appsPath)
if not raw or raw == "" then
  ngx.status = 502
  ngx.header["Content-Type"] = "text/plain"
  ngx.say("surface_proxy: apps.json not found — no monad registered yet")
  return ngx.exit(502)
end

local registry = cjson.decode(raw)
if not registry or type(registry.apps) ~= "table" then
  ngx.status = 502
  ngx.header["Content-Type"] = "text/plain"
  ngx.say("surface_proxy: apps.json parse error")
  return ngx.exit(502)
end

local nowMs = ngx.now() * 1000
local target = nil

for _, app in pairs(registry.apps) do
  -- Check ttl first
  local ttl      = tonumber(app.ttlMs)    or 45000
  local lastSeen = tonumber(app.lastSeenMs) or 0
  if lastSeen > 0 and (nowMs - lastSeen) > ttl then
    -- stale, skip
  else
    local appHost = ""
    local meta = app.metadata
    if meta then
      -- Prefer namespace match, fall back to hostname
      local ns = (meta.namespace or ""):lower()
      local hn = (app.hostname or ""):lower()
      if ns == host or hn == host then
        local ep = meta.directEndpoint or meta.endpoint or meta.controlEndpoint
        if ep then
          target = ep
          break
        end
      end
    end
  end
end

if not target then
  ngx.status = 502
  ngx.header["Content-Type"] = "application/json"
  ngx.say(cjson.encode({
    error   = "no live monad for host: " .. host,
    host    = host,
    hint    = "Start a monad with this namespace and ensure it registers with netget",
  }))
  return ngx.exit(502)
end

-- Remove trailing slash for clean proxy_pass
target = target:match("^(.-)/*$") or target

ngx.var.surface_proxy_target = target
