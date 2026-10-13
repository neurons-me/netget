-- surface_proxy.lua
-- Mesh-aware reverse proxy: routes hostname → best available monad.
--
-- Selection, strongest first (the registry says WHERE a monad is and whether it is alive; it does not decide which
-- host it serves unless nothing else does):
--   1. A DECLARED route for this exact host in runtime/domain-map.json (the domain store: panel / `netget routing`).
--      `app:<name>` is resolved by app name against the registry, live by TTL, exactly as the main routing table does.
--      A declared target that is not available is "not available": it never falls back to another monad.
--   2. Monads that DECLARE the host as their own (canonical namespace/identity, publicHost, domain, aliases, hosts,
--      domains, claimed_namespaces). One identity: it serves (most recent registration of that identity). More than
--      one distinct identity and no declared route: a CONFLICT is answered, not resolved by recency or trust.
--   3. Nobody declares the host (a handle under a root): only a monad that IS the root may answer for it.
--   A declared route may carry CONNECTIONS (lib/door_connections.lua): path prefixes the operator sent to a service of the
--   app that is not its monad (FullTrailer's own server at /api/fuel). They are checked before the destination answers;
--   a matching one is answered by that service or by a JSON error, never by the monad or the app's HTML.
--   Tags and the machine's name are advertisements, never selectors: sharing a root tag does not let one app serve
--   another app's host. An IP request still goes to any live monad (the address is transport only).
--
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

-- What a monad SAYS about the names it serves, in two strengths. Both are self-reported (registration is loopback-only,
-- but nothing cryptographically binds a monad to a host: see CLAUDE.md, gaps #1/#2), so neither is an authority:
--
--   declared claim  its own canonical identity/namespace, or the names it lists as its own (publicHost, domain,
--                   aliases, hosts, domains, claimed_namespaces). This is what can select a monad for a host.
--   advertisement   the machine's name (host/hostname) and `tags`. Tags are labels (`local`, `monad`, the root name…),
--                   shared by every monad on the machine. They NEVER select a monad: sharing a root tag does not let one
--                   app serve another app's host.
local function declares_host(meta, target)
  if not target or target == "" or type(meta) ~= "table" then return false end
  if normalize_host(meta.namespace) == target then return true end
  if normalize_host(meta.identity) == target then return true end
  if normalize_host(meta.publicHost) == target then return true end
  if normalize_host(meta.public_host) == target then return true end
  if normalize_host(meta.domain) == target then return true end
  if table_has_host(meta.aliases, target) then return true end
  if table_has_host(meta.hosts, target) then return true end
  if table_has_host(meta.domains, target) then return true end
  if table_has_host(meta.claimedNamespaces, target) then return true end
  if table_has_host(meta.claimed_namespaces, target) then return true end
  return false
end

-- The monad IS the root (its canonical identity/namespace is the root name): the one that answers for the handles
-- under it. Not a monad that merely lists the root among its tags.
local function is_root_monad(meta, rootspace)
  if type(meta) ~= "table" or not rootspace or rootspace == "" then return false end
  return normalize_host(meta.namespace) == rootspace or normalize_host(meta.identity) == rootspace
end

-- The monad registers a loopback address; `localhost` as a name would be looked up by nginx's (public) resolver and
-- not found. The registration is loopback-only, so the name and the literal mean the same machine.
local function loopback_literal(endpoint)
  return (tostring(endpoint or ""):gsub("^(https?://)[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt]([:/]?)", "%1127.0.0.1%2"))
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
    if _G.render_no_monad then
      local hint = is_registered
        and "Start a monad with this namespace and ensure it registers with netget."
        or "Run `netget init` on this server, then refresh."
      local body = _G.render_no_monad(host, rootspace_of(host), hint, reason)
      if body then
        ngx.header["Content-Type"] = "text/html; charset=utf-8"
        ngx.say(body)
        return ngx.exit(503)
      end
    end
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

local function is_live(app)
  local ttl      = tonumber(app.ttlMs)     or 45000
  local lastSeen = tonumber(app.lastSeenMs) or 0
  return lastSeen == 0 or (nowMs - lastSeen) <= ttl
end

local function endpoint_of(meta)
  local ep = meta and (meta.directEndpoint or meta.endpoint or meta.controlEndpoint)
  if ep and ep ~= "" then return loopback_literal(ep) end
  return nil
end

local function identity_of(meta)
  return meta and (meta.identity_hash or meta.identityHash) or nil
end

local function send_conflict_page(identities)
  ngx.log(ngx.WARN, "surface_proxy: conflict for host '", host, "' — identities ", table.concat(identities, ", "),
    " all declare it and no declared route (domain-map.json) says which one serves it")
  return send_no_monad_page("conflict: more than one monad declares " .. host .. " and no route chooses between them", true)
end

local function route_to(endpoint, identity)
  ngx.var.surface_proxy_target = (endpoint:match("^(.-)/*$") or endpoint)
  ngx.var.surface_proxy_identity = identity or ""
end

-- ── 1. A DECLARED route for this exact host (the patch bay: domain-map.json, projected from the domain store the
--       panel and `netget routing` write). It is the authority: the monad registry supplies where the target is and
--       whether it is alive, never which host it serves. A declared target that is not available is "not available",
--       not a reason to fall back to some other monad.
local function declared_route(for_host)
  local rawMap = read_file(getNetgetDataDir() .. "/runtime/domain-map.json")
  if not rawMap or rawMap == "" then return nil end
  local okm, map = pcall(cjson.decode, rawMap)
  if not okm or type(map) ~= "table" or type(map.domains) ~= "table" then return nil end
  local route = map.domains[for_host]
  if type(route) ~= "table" then return nil end
  if route.type ~= "proxy" and route.type ~= "server" then return nil end
  if type(route.target) ~= "string" or route.target == "" then return nil end
  return route
end

-- A connection of the door answers a request before the door's main destination does (see lib/door_connections.lua).
-- It is answered by the connection's service, or by an error: never by the monad and never by the app's HTML, which
-- would answer an API call with a page. The error is JSON whatever the client accepts.
local function answer_connection(route)
  local ok, dc = pcall(require, "lib.door_connections")
  if not ok then
    ngx.log(ngx.ERR, "surface_proxy: lib.door_connections is not installed; connections of ", host, " are not applied")
    if type(route.connections) == "table" and #route.connections > 0 then
      ngx.status = 502
      ngx.header["Content-Type"] = "application/json; charset=utf-8"
      ngx.say(cjson.encode({ ok = false, error = "connection_not_applied", message = "door connections are not available on this gateway" }))
      return ngx.exit(502)
    end
    return
  end
  local decision = dc.decide(route.connections, ngx.var.uri, registry)
  if not decision then return end
  -- Who may use it: the exposure policy of the app this door points at (an `app:<name>` target). A door that points
  -- at a bare host:port has no app and therefore no policy: judged as loopback-only.
  local door_app
  local want = tostring(route.target or ""):match("^app:(.+)$")
  if want then
    want = want:lower()
    for _, app in pairs(registry.apps) do
      local meta = type(app.metadata) == "table" and app.metadata or {}
      local name = tostring(app.name or ""):lower()
      local short = name:gsub("^monad:", "")
      if (name == want or short == want or tostring(meta.monadName or ""):lower() == want) and is_live(app) then
        door_app = app
        break
      end
    end
    if not door_app then
      ngx.status = 503
      ngx.header["Content-Type"] = "application/json; charset=utf-8"
      ngx.say(cjson.encode({ ok = false, error = "app_not_available", prefix = decision.prefix,
        message = "The app behind this door is not live." }))
      return ngx.exit(503)
    end
  end
  local allowed, denied_status = dc.exposure_allows(door_app or {}, ngx.var.remote_addr)
  if not allowed then
    ngx.status = denied_status or 403
    ngx.header["Content-Type"] = "application/json; charset=utf-8"
    ngx.say(cjson.encode({ ok = false, error = "connection_forbidden", prefix = decision.prefix,
      message = "This door does not serve that path to this address." }))
    return ngx.exit(ngx.status)
  end
  if decision.error then
    ngx.log(ngx.WARN, "surface_proxy: connection ", decision.prefix, " of ", host, " not applied: ", decision.error)
    ngx.status = 502
    ngx.header["Content-Type"] = "application/json; charset=utf-8"
    ngx.say(cjson.encode({ ok = false, error = "connection_not_applied", prefix = decision.prefix, message = decision.error }))
    return ngx.exit(502)
  end
  ngx.var.door_connection_target = decision.upstream
  ngx.var.door_connection_prefix = decision.prefix
  return ngx.exec("@door_connection")
end

if not host_is_ip then
  local route = declared_route(host)
  local declared = route and route.target
  if declared then
    answer_connection(route)
    if declared:sub(1, 4) == "app:" then
      local want = declared:sub(5):lower()
      local best
      for _, app in pairs(registry.apps) do
        local meta = app.metadata or {}
        local name = tostring(app.name or ""):lower()
        local short = name:gsub("^monad:", "")
        local named = (name == want) or (short == want) or (tostring(meta.monadName or ""):lower() == want)
        if named and is_live(app) then
          local ep = endpoint_of(meta)
          if not ep and app.port then ep = "http://" .. (app.host or "127.0.0.1") .. ":" .. tostring(app.port) end
          if ep and (not best or (tonumber(app.lastSeenMs) or 0) > best.lastSeen) then
            best = { ep = ep, lastSeen = tonumber(app.lastSeenMs) or 0, identity = identity_of(meta) }
          end
        end
      end
      if not best then
        return send_no_monad_page("declared target " .. declared .. " for " .. host .. " is not available", true)
      end
      route_to(best.ep, best.identity)
      return
    end
    -- host:port or http(s)://host:port, used as written (same as the main routing table)
    local direct = declared:match("^https?://") and declared or ("http://" .. declared)
    route_to(loopback_literal(direct), "")
    return
  end
end

-- ── 2. No declared route. Select by what monads DECLARE as their own (never by tags).
local exact, root_candidates = {}, {}
for _, app in pairs(registry.apps) do
  local meta = app.metadata
  if type(meta) == "table" and endpoint_of(meta) then
    local entry = { ep = endpoint_of(meta), lastSeen = tonumber(app.lastSeenMs) or 0, identity = identity_of(meta), live = is_live(app), trust = app.trust }
    if host_is_ip then
      -- IP request: the address is transport only; any live monad answers and resolves the namespace itself.
      if entry.live then table.insert(exact, entry) end
    elseif declares_host(meta, host) then
      table.insert(exact, entry)
    elseif is_root_monad(meta, rootspace) then
      table.insert(root_candidates, entry)
    end
  end
end

local function most_recent(list)
  local best
  for _, c in ipairs(list) do
    if not best or c.lastSeen > best.lastSeen then best = c end
  end
  return best
end

if host_is_ip then
  local best = most_recent(exact)
  if not best then return send_no_monad_page("no live monad for: " .. host, true) end
  route_to(best.ep, best.identity)
  return
end

if #exact > 0 then
  -- Someone declares this exact host. Only monads that declare it can serve it.
  local live, identities, seen = {}, {}, {}
  for _, c in ipairs(exact) do
    if c.live then
      table.insert(live, c)
      local id = c.identity or "(no identity)"
      if not seen[id] then seen[id] = true; table.insert(identities, id) end
    end
  end
  if #live == 0 then
    return send_no_monad_page("the monad that declares " .. host .. " is not live", true)
  end
  if #identities > 1 then
    return send_conflict_page(identities)
  end
  local best = most_recent(live)
  route_to(best.ep, best.identity)
  return
end

-- ── 3. Nobody declares this host: it is a handle under a root. Only a monad that IS the root may answer for it.
local live_roots = {}
for _, c in ipairs(root_candidates) do if c.live then table.insert(live_roots, c) end end
local best = most_recent(live_roots)
if not best then
  return send_no_monad_page("no live monad for: " .. host, true)
end
route_to(best.ep, best.identity)
