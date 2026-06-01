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

local function wants_html()
  local accept = ngx.var.http_accept or ""
  return accept:find("text/html") ~= nil
end

local function send_no_monad_page(reason)
  ngx.status = 503
  if wants_html() then
    ngx.header["Content-Type"] = "text/html; charset=utf-8"
    ngx.say([[<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>NetGet — Setup Required</title>
<style>
  :root { --green: #4caf50; --dark: #0d1117; --card: #161b22; --border: #30363d; --text: #e6edf3; --muted: #8b949e; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--dark); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; max-width: 480px; width: 100%; padding: 2.5rem; text-align: center; }
  .logo { margin-bottom: 2rem; }
  .logo img { width: 72px; height: 72px; object-fit: contain; }
  h1 { font-size: 1.3rem; font-weight: 600; margin-bottom: 2rem; }
  .step { display: flex; gap: 1rem; margin-bottom: 1.25rem; align-items: flex-start; text-align: left; }
  .step-num { background: var(--green); color: #000; border-radius: 50%; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; margin-top: 0.15rem; }
  .step-text { font-size: 0.9rem; line-height: 1.5; color: var(--muted); }
  .step-text strong { color: var(--text); }
  code { background: #0d1117; border: 1px solid var(--border); border-radius: 6px; padding: 0.65rem 1rem; display: block; font-size: 0.9rem; color: var(--green); margin-top: 0.5rem; font-family: monospace; letter-spacing: 0.04em; }
  .divider { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  .note { font-size: 0.8rem; color: var(--muted); }
  .note a { color: var(--green); text-decoration: none; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <img src="https://res.cloudinary.com/dkwnxf6gm/image/upload/v1760629064/neurons.me_b50f6a.png" alt="neurons.me"/>
  </div>
  <h1>Gateway not initialized</h1>

  <div class="step">
    <div class="step-num">1</div>
    <div class="step-text"><strong>Run on this server:</strong><code>netget</code></div>
  </div>

  <div class="step">
    <div class="step-num">2</div>
    <div class="step-text"><strong>Navigate to Main Server</strong> — the gateway will auto-setup and start a monad.</div>
  </div>

  <div class="step">
    <div class="step-num">3</div>
    <div class="step-text"><strong>Refresh this page</strong> once the monad is running.</div>
  </div>

  <hr class="divider"/>
  <p class="note"><a href="https://github.com/neurons-me/netget">github.com/neurons-me/netget</a></p>
</div>
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
  return send_no_monad_page("no monad registered yet")
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
  return send_no_monad_page("no live monad for: " .. host)
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
