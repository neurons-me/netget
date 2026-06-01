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

local function normalize_host(value)
  local raw = tostring(value or ""):lower()
  raw = raw:gsub("^https?://", "")
  raw = raw:gsub("^%[", ""):gsub("%]$", "")
  raw = raw:match("^([^:/]+)") or raw
  return raw
end

local function table_has_host(values, target)
  if type(values) ~= "table" then return false end
  for _, value in pairs(values) do
    if normalize_host(value) == target then return true end
  end
  return false
end

local function app_claims_host(app, meta, target)
  if not target or target == "" then return false end
  if normalize_host(meta.namespace) == target then return true end
  if normalize_host(meta.identity) == target then return true end
  if normalize_host(meta.host) == target then return true end
  if normalize_host(meta.hostname) == target then return true end
  if normalize_host(meta.publicHost) == target then return true end
  if normalize_host(meta.public_host) == target then return true end
  if normalize_host(meta.domain) == target then return true end
  if table_has_host(meta.aliases, target) then return true end
  if table_has_host(meta.hosts, target) then return true end
  if table_has_host(meta.domains, target) then return true end
  if table_has_host(meta.claimedNamespaces, target) then return true end
  if table_has_host(meta.claimed_namespaces, target) then return true end
  if table_has_host(app.tags, target) then return true end
  return false
end

local host = (ngx.var.host or ""):lower()
host = host:match("^([^:]+)") or host

local function wants_html()
  local accept = ngx.var.http_accept or ""
  return accept:find("text/html") ~= nil
end

local function send_no_monad_page(reason, is_registered)
  ngx.status = 503
  if wants_html() then
    ngx.header["Content-Type"] = "text/html; charset=utf-8"
    ngx.say([[<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>NetGet</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #121416; font-family: 'Roboto', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .pedal { width: 95%; max-width: 520px; background: #141e1d; padding: 30px; border-radius: 12px; box-shadow: 0 8px 18px rgba(0,0,0,0.6); text-align: center; }
  .logo { margin-bottom: 20px; }
  .logo img { width: 52px; height: 52px; object-fit: contain; }
  h1 { color: #17bdcc; font-size: 1.6em; letter-spacing: 2px; text-shadow: 0 0 6px rgba(23,189,204,0.4); margin-bottom: 6px; }
  .subtitle { color: #4a6e6b; font-size: 0.85em; margin-bottom: 28px; letter-spacing: 1px; }
  .display-row { margin-bottom: 14px; text-align: left; }
  .display-label { color: #fff; font-size: 0.8em; margin-bottom: 5px; letter-spacing: 1px; text-transform: uppercase; }
  .display-val { background: #0b1416; color: #17bdcc; font-size: 0.9em; padding: 10px 14px; border-radius: 6px; border: 1px solid #1a2528; font-family: 'Courier New', monospace; }
  .display-val.muted { color: #4a6e6b; }
  .divider { border: none; border-top: 1px solid #1a2528; margin: 24px 0; }
  .step-list { text-align: left; display: flex; flex-direction: column; gap: 12px; }
  .step { display: flex; gap: 12px; align-items: flex-start; }
  .step-num { background: #17bdcc; color: #0b1416; border-radius: 50%; width: 20px; height: 20px; font-size: 0.7em; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
  .step-text { color: #8aacaa; font-size: 0.88em; line-height: 1.5; }
  .step-text strong { color: #e0f0ef; }
  .cmd { background: #0b1416; border: 1px solid #1a2528; border-radius: 6px; padding: 8px 14px; color: #17bdcc; font-family: 'Courier New', monospace; font-size: 0.9em; margin-top: 6px; display: block; letter-spacing: 0.05em; }
  .footer { margin-top: 24px; font-size: 0.75em; color: #2d4a47; }
  .footer a { color: #2d4a47; text-decoration: none; }
</style>
</head>
<body>
<div class="pedal">
  <div class="logo">
    <img src="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1760629064/neurons.me_b50f6a.png" alt="neurons.me"/>
  </div>
  <h1>NetGet</h1>
  <p class="subtitle">]] .. (is_registered and "NO LIVE MONAD" or "GATEWAY NOT INITIALIZED") .. [[</p>

  <div class="display-row">
    <div class="display-label">Host</div>
    <div class="display-val" id="host-display">—</div>
  </div>

  <div class="divider"></div>

  <div class="step-list">]] .. (is_registered and [[
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text"><strong>Start a monad:</strong><span class="cmd">monads start local</span></div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text"><strong>Refresh</strong> this page.</div>
    </div>]] or [[
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text"><strong>Run on this server:</strong><span class="cmd">netget init</span></div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text"><strong>Refresh</strong> this page.</div>
    </div>]]) .. [[
  </div>

  <p class="footer"><a href="https://github.com/neurons-me/netget">neurons-me/netget</a></p>
</div>
<script>
  document.getElementById('host-display').textContent = window.location.hostname;
</script>
</body>
</html>]])
  else
    ngx.header["Content-Type"] = "application/json"
    ngx.say(cjson.encode({ error = reason, hint = "Run: netget" }))
  end
  return ngx.exit(503)
end

local raw = read_file(appsPath)
if not raw or raw == "" then
  return send_no_monad_page("no monad registered yet", false)
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
          -- Hostname-based request: match by canonical namespace or declared aliases.
          matches = app_claims_host(app, meta, rootspace) or app_claims_host(app, meta, host)
        end

        if matches then
          table.insert(candidates, { ep = ep, lastSeen = lastSeen, ns = ns })
        end
      end
    end
  end
end

if #candidates == 0 then
  return send_no_monad_page("no live monad for: " .. host, true)
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
