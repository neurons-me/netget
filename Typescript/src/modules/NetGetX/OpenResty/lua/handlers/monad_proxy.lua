local cjson = require "cjson.safe"

local function getNetgetDataDir()
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return os.getenv("HOME") .. "/.get"
end

local runtimeDir  = getNetgetDataDir() .. "/runtime"
local appsPath    = runtimeDir .. "/apps.json"
local catalogPath = runtimeDir .. "/monad-catalog.json"

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function read_registry()
  local raw = read_file(appsPath)
  if not raw or raw == "" then
    return { apps = {} }
  end
  local decoded = cjson.decode(raw)
  if not decoded or type(decoded) ~= "table" then
    return { apps = {} }
  end
  decoded.apps = decoded.apps or {}
  return decoded
end

local function read_catalog()
  local raw = read_file(catalogPath)
  if not raw or raw == "" then return {} end
  local decoded = cjson.decode(raw)
  return type(decoded) == "table" and decoded or {}
end

local function spawn_monad(entry, name)
  local cmd = tostring(entry.cmd or "")
  if cmd == "" then return false end
  local home = os.getenv("HOME") or ""
  local cwd  = tostring(entry.cwd or home):gsub("^~", home)
  local log  = runtimeDir .. "/" .. name .. ".spawn.log"
  local full = string.format("cd %s && %s >> %s 2>&1 &", cwd, cmd, log)
  local h = io.popen(full)
  if h then h:close() end
  return true
end

local function normalize_token(value)
  local text = tostring(value or ""):lower()
  text = text:gsub("[^a-z0-9%._%-]+", "-")
  text = text:gsub("^%-+", ""):gsub("%-+$", "")
  return text
end

local function has_tag(app, tag)
  if type(app.tags) ~= "table" then return false end
  for _, value in ipairs(app.tags) do
    if normalize_token(value) == tag then return true end
  end
  return false
end

local function app_monad_name(app)
  local metadata = type(app.metadata) == "table" and app.metadata or {}
  local direct = normalize_token(metadata.monadName)
  if direct ~= "" then return direct end
  local name = tostring(app.name or "")
  name = name:gsub("^monad:", "")
  return normalize_token(name)
end

local function is_monad_app(app)
  local name = tostring(app.name or ""):lower()
  return app.kind == "monad" or name:match("^monad:") or has_tag(app, "monad")
end

local function is_fresh(app)
  local ttl = tonumber(app.ttlMs) or 45000
  local last_seen = tonumber(app.lastSeenMs) or 0
  if last_seen <= 0 then return false end
  return ngx.now() * 1000 - last_seen <= ttl
end

local function is_loopback_ip(ip)
  return ip == "127.0.0.1" or ip == "::1" or ip == "unix:"
end

local function is_lan_ip(ip)
  if is_loopback_ip(ip) then return true end
  if ip:match("^10%.") then return true end
  if ip:match("^192%.168%.") then return true end
  local second = tonumber(ip:match("^172%.(%d+)%."))
  if second and second >= 16 and second <= 31 then return true end
  if ip:match("^169%.254%.") then return true end
  if ip:match("^fe80:") or ip:match("^fd") then return true end
  return false
end

local function is_loopback_host(host)
  host = tostring(host or ""):lower()
  return host == "127.0.0.1" or host == "localhost" or host == "::1" or host == "[::1]"
end

local function exposure_allows_request(app)
  local exposure = type(app.exposure) == "table" and app.exposure or {}
  if exposure.enabled == false then return false, ngx.HTTP_NOT_FOUND end

  local visibility = tostring(exposure.visibility or "loopback")
  local network = type(exposure.network) == "table" and exposure.network or {}
  local remote = ngx.var.remote_addr or ""

  if is_loopback_ip(remote) then
    return network.allowLoopback ~= false, ngx.HTTP_FORBIDDEN
  end

  if visibility == "loopback" then
    return false, ngx.HTTP_FORBIDDEN
  end

  if visibility == "lan" then
    return is_lan_ip(remote) and network.allowLan ~= false, ngx.HTTP_FORBIDDEN
  end

  if visibility == "wan" then
    return network.allowWan ~= false, ngx.HTTP_FORBIDDEN
  end

  return false, ngx.HTTP_FORBIDDEN
end

local function find_monad(name)
  local wanted = normalize_token(ngx.unescape_uri(name or ""))
  if wanted == "" then return nil end

  local registry = read_registry()
  for _, app in pairs(registry.apps or {}) do
    if is_monad_app(app) and is_fresh(app) then
      local monad_name = app_monad_name(app)
      local app_id = normalize_token(app.id)
      if monad_name == wanted or app_id == wanted then
        return app
      end
    end
  end
  return nil
end

local function resolve_target(app)
  local protocol = tostring(app.protocol or "http"):lower()
  if protocol ~= "http" and protocol ~= "https" then
    protocol = "http"
  end

  local host = tostring(app.host or "127.0.0.1")
  if not is_loopback_host(host) then
    return nil, "Monad proxy only accepts loopback app targets."
  end

  local port = tonumber(app.port)
  if not port or port < 1 or port > 65535 then
    return nil, "Monad app is missing a valid port."
  end

  return protocol .. "://" .. host .. ":" .. tostring(port)
end

-- ── Name-based routing with catalog auto-start ────────────────────────────────
-- Name is the stable identity. Port is just transport.
-- If the monad isn't live, check the catalog and spawn it, then wait up to 8s.

local wanted = normalize_token(ngx.var.monad_proxy_name)
local app = find_monad(wanted)

if not app then
  local catalog = read_catalog()
  local entry   = catalog[wanted]

  if entry and entry.autoStart ~= false then
    spawn_monad(entry, wanted)
    for _ = 1, 16 do
      ngx.sleep(0.5)
      app = find_monad(wanted)
      if app then break end
    end
  end

  if not app then
    ngx.status = entry and ngx.HTTP_SERVICE_UNAVAILABLE or ngx.HTTP_NOT_FOUND
    ngx.header["Content-Type"] = "application/json; charset=utf-8"
    ngx.say(cjson.encode({
      error   = entry and "monad_starting" or "monad_not_found",
      name    = wanted,
      message = entry
        and ("Monad '" .. wanted .. "' is starting — retry in a moment.")
        or  ("Monad '" .. wanted .. "' is not registered. "
             .. "Add it to monad-catalog.json to enable auto-start."),
    }))
    return ngx.exit(ngx.status)
  end
end

-- Gate 1: Trust
local trust = tostring(app.trust or "")
if trust == "guest" then
  local uri = tostring(ngx.var.uri or "")
  local is_health = uri == "/health" or uri == "/status"
                    or uri:match("^/health[/?]") or uri:match("^/status[/?]")
  if not is_health then
    ngx.status = ngx.HTTP_FORBIDDEN
    ngx.say("NetGet: monad has guest trust. Only /health and /status are accessible.")
    return ngx.exit(ngx.HTTP_FORBIDDEN)
  end
end

-- Gate 2: Exposure
local allowed, status = exposure_allows_request(app)
if not allowed then
  ngx.status = status or ngx.HTTP_FORBIDDEN
  ngx.say("NetGet policy denied this monad route.")
  return ngx.exit(ngx.status)
end

local target, err = resolve_target(app)
if not target then
  ngx.status = ngx.HTTP_SERVICE_UNAVAILABLE
  ngx.say(err or "NetGet monad target is not available.")
  return ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
end

ngx.var.monad_proxy_target = target

-- Monads resolve which namespace's data to serve from the inbound Host
-- header (see monad/Typescript's resolveHostNamespace()), not from how
-- they were addressed. Left unchanged, this route forwards the client's
-- original Host (e.g. "local.netget", the gateway's own hostname) straight
-- through — so a request explicitly routed BY NAME to a specific monad
-- gets answered using the gateway's Host as the namespace instead of the
-- monad's own claimed one, silently returning empty/wrong data instead of
-- what that monad actually holds. Overriding Host to the resolved app's own
-- registered namespace makes /apps/:name and /monads/:name equivalent to
-- addressing the monad directly with its own identity as Host — exactly
-- the behavior a name-based route should have.
local metadata = type(app.metadata) == "table" and app.metadata or {}
local target_namespace = metadata.namespace or metadata.identity
if target_namespace and target_namespace ~= "" then
  ngx.req.set_header("Host", tostring(target_namespace))
end

local tail = ngx.var.monad_proxy_tail
if not tail or tail == "" then tail = "/" end
ngx.req.set_uri(tail, false)
