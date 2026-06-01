-- surface_proxy.lua
-- Mesh-aware reverse proxy: routes hostname → best available monad.
--
-- Algorithm (synthesis by reduction):
--   1. Read apps.json (live monad mesh registry)
--   2. Extract rootspace from request host
--      jabellae.suis-macbook-air.local → rootspace = suis-macbook-air.local
--      suis-macbook-air.local          → rootspace = suis-macbook-air.local
--      34.28.109.244 (IP)              → fallback: any live monad on this machine
--   3. Collect ALL live monads that claim that rootspace
--   4. Reduce to the single best candidate by recency (most recently seen wins)
--   5. Route to its endpoint — the monad handles semantic resolution internally
--
-- This implements the NRP "Total monad" synthesis: the caller never needs to
-- know which monad instance answers. The mesh picks the best one available now.

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

-- True when host is a raw IPv4 or IPv6 address (not a hostname).
-- IP-based requests fall back to "any live monad" — the namespace is
-- determined by whatever monad is registered on this machine.
local function is_ip(h)
  -- IPv4: digits and dots only
  if h:match("^%d+%.%d+%.%d+%.%d+$") then return true end
  -- IPv6: contains colons
  if h:match(":") then return true end
  return false
end

-- Extract rootspace from a compound namespace.
-- jabellae.suis-macbook-air.local → suis-macbook-air.local
-- suis-macbook-air.local          → suis-macbook-air.local
local function rootspace_of(host)
  -- Split on dots. If 3+ labels and last two form a known pattern (.local, .me, etc.)
  -- the rootspace is everything after the first label.
  local labels = {}
  for label in host:gmatch("[^.]+") do
    table.insert(labels, label)
  end
  if #labels >= 3 then
    -- First label is the user handle, rest is the rootspace
    table.remove(labels, 1)
    return table.concat(labels, ".")
  end
  return host
end

local host = (ngx.var.host or ""):lower()
host = host:match("^([^:]+)") or host

local raw = read_file(appsPath)
if not raw or raw == "" then
  ngx.status = 502
  ngx.header["Content-Type"] = "application/json"
  ngx.say(cjson.encode({
    error = "no monad registered yet",
    hint  = "Start a monad and ensure it registers with netget",
  }))
  return ngx.exit(502)
end

local registry = cjson.decode(raw)
if not registry or type(registry.apps) ~= "table" then
  ngx.status = 502
  ngx.header["Content-Type"] = "text/plain"
  ngx.say("surface_proxy: apps.json parse error")
  return ngx.exit(502)
end

local nowMs     = ngx.now() * 1000
local rootspace = rootspace_of(host)
local host_is_ip = is_ip(host)

-- Collect all live candidates.
-- Matching rules:
--   hostname request → match by namespace == rootspace or namespace == host
--   IP request       → match any live monad (IP is routing only, not identity)
local candidates = {}

for _, app in pairs(registry.apps) do
  local ttl      = tonumber(app.ttlMs)     or 45000
  local lastSeen = tonumber(app.lastSeenMs) or 0

  -- Skip stale entries
  if lastSeen == 0 or (nowMs - lastSeen) <= ttl then
    local meta = app.metadata
    if meta then
      local ns = (meta.namespace or ""):lower()
      local ep = meta.directEndpoint or meta.endpoint or meta.controlEndpoint

      if ep and ep ~= "" then
        local matches
        if host_is_ip then
          -- IP-based request: any live monad can answer.
          -- Hostname is transport only — namespace is resolved by the monad.
          matches = true
        else
          -- Hostname-based request: match by namespace
          matches = (ns == rootspace) or (ns == host)
        end

        if matches then
          table.insert(candidates, { ep = ep, lastSeen = lastSeen, ns = ns })
        end
      end
    end
  end
end

if #candidates == 0 then
  ngx.status = 502
  ngx.header["Content-Type"] = "application/json"
  ngx.say(cjson.encode({
    error     = "no live monad for: " .. host,
    rootspace = rootspace,
    host      = host,
    is_ip     = host_is_ip,
    hint      = "Start a monad and ensure it registers with netget",
  }))
  return ngx.exit(502)
end

-- Reduce: pick the most recently seen monad (highest lastSeenMs).
-- This is the local approximation of NRP scoring — full scoring happens
-- inside the monad itself for cross-monad mesh requests.
local best = candidates[1]
for i = 2, #candidates do
  if candidates[i].lastSeen > best.lastSeen then
    best = candidates[i]
  end
end

local target = best.ep:match("^(.-)/*$") or best.ep
ngx.var.surface_proxy_target = target
