local cjson = require "cjson.safe"

local function getNetgetDataDir()
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return os.getenv("HOME") .. "/.get"
end

local netgetDir   = getNetgetDataDir()
local runtimeDir  = netgetDir .. "/runtime"
local appsPath    = runtimeDir .. "/apps.json"
local claimsPath  = runtimeDir .. "/gateway-claims.json"
local catalogPath = runtimeDir .. "/monad-catalog.json"

local function set_json()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function json(status, payload)
  set_json()
  ngx.status = status
  ngx.say(cjson.encode(payload or {}))
end

local function is_local_request()
  local ip = ngx.var.remote_addr or ""
  return ip == "127.0.0.1" or ip == "::1" or ip == "unix:"
end

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
    return { version = 1, apps = {} }
  end
  local decoded = cjson.decode(raw)
  if not decoded or type(decoded) ~= "table" then
    return { version = 1, apps = {} }
  end
  decoded.apps = decoded.apps or {}
  return decoded
end

local function write_registry(registry)
  os.execute("mkdir -p " .. runtimeDir)
  registry.version = (tonumber(registry.version) or 0) + 1
  registry.updatedAt = os.date("!%Y-%m-%dT%H:%M:%SZ")

  local tmp = appsPath .. ".tmp"
  local f, err = io.open(tmp, "w")
  if not f then return nil, err end
  f:write(cjson.encode(registry))
  f:close()
  return os.rename(tmp, appsPath)
end

local function now_ms()
  return ngx.now() * 1000
end

-- Read the gateway claims snapshot (written by GatewayClaimsManager).
-- Returns {} when the file is absent or unparseable — safe fallback to guest.
local function read_claims()
  local raw = read_file(claimsPath)
  if not raw or raw == "" then return {} end
  local decoded = cjson.decode(raw)
  return type(decoded) == "table" and decoded or {}
end

-- Resolve trust level from the app's identity_hash against the gateway claims.
--   owner  → identity_hash == claims.owner
--   admin  → identity_hash in claims.admins
--   peer   → identity_hash present but not owner/admin
--   guest  → identity_hash absent or empty
local function derive_trust(identity_hash, claims)
  if not identity_hash or identity_hash == "" then return "guest" end
  if claims.owner and identity_hash == claims.owner then return "owner" end
  if type(claims.admins) == "table" and claims.admins[identity_hash] then return "admin" end
  return "peer"
end

local function scrub_dead_apps(registry)
  local current = now_ms()
  local live = {}
  for id, app in pairs(registry.apps or {}) do
    local ttl = tonumber(app.ttlMs) or 45000
    local lastSeen = tonumber(app.lastSeenMs) or 0
    if current - lastSeen <= ttl then
      live[id] = app
    end
  end
  registry.apps = live
  return registry
end

local function report_app()
  if not is_local_request() then
    return json(403, { success = false, error = "Apps can only report to the local NetGet agent." })
  end

  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  if not body or body == "" then
    return json(400, { success = false, error = "JSON body is required." })
  end

  local app = cjson.decode(body)
  if not app or type(app) ~= "table" then
    return json(400, { success = false, error = "Invalid JSON body." })
  end
  if not app.id or not app.name then
    return json(400, { success = false, error = "App id and name are required." })
  end

  local registry = scrub_dead_apps(read_registry())
  app.lastSeenMs = now_ms()
  app.localOnly = true

  -- Materialize trust level at ingest time — never re-derived at route time.
  local claims = read_claims()
  local meta = type(app.metadata) == "table" and app.metadata or {}
  local id_hash = tostring(meta.identity_hash or meta.identityHash or "")
  app.trust = derive_trust(id_hash, claims)
  if app.trust ~= "guest" then
    app.verified_at = now_ms()
  end

  -- frontendMode is an operator preference (set via the frontend_mode
  -- action below, not reported by the app itself) — this assignment is a
  -- wholesale replace, so without preserving it here the next heartbeat
  -- (≤ MONAD_NETGET_HEARTBEAT_MS, ~3s) would silently wipe the toggle back
  -- to unset every time.
  local existing = registry.apps[app.id]
  if existing and existing.frontendMode and not app.frontendMode then
    app.frontendMode = existing.frontendMode
  end

  registry.apps[app.id] = app

  local ok, err = write_registry(registry)
  if not ok then
    return json(500, { success = false, error = err or "Could not write app registry." })
  end

  return json(200, { success = true, id = app.id, localOnly = true })
end

local function list_apps()
  if not is_local_request() then
    return json(403, { success = false, error = "App registry is local-only until auth/policies are enabled." })
  end

  local registry = scrub_dead_apps(read_registry())
  write_registry(registry)

  local apps = {}
  for _, app in pairs(registry.apps or {}) do
    table.insert(apps, app)
  end

  local count = #apps
  if count == 0 then apps = cjson.empty_array end
  return json(200, { success = true, apps = apps, count = count, updatedAt = registry.updatedAt })
end

local function release_app()
  if not is_local_request() then
    return json(403, { success = false, error = "Apps can only release from the local NetGet agent." })
  end

  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  if not body or body == "" then
    return json(400, { success = false, error = "JSON body is required." })
  end

  local req = cjson.decode(body)
  if not req or type(req) ~= "table" or not req.id then
    return json(400, { success = false, error = "App id is required." })
  end

  local registry = read_registry()
  registry.apps[req.id] = nil

  local ok, err = write_registry(registry)
  if not ok then
    return json(500, { success = false, error = err or "Could not write app registry." })
  end

  return json(200, { success = true, id = req.id })
end

local function restart_all()
  if not is_local_request() then
    return json(403, { success = false, error = "Only local requests can restart monads." })
  end
  if ngx.req.get_method() ~= "POST" then
    return json(405, { success = false, error = "Use POST." })
  end
  local registry = scrub_dead_apps(read_registry())
  local restarted, skipped = {}, {}
  for _, app in pairs(registry.apps or {}) do
    local port = tonumber(app.port)
    if port and port > 0 then
      local handle = io.popen(string.format("lsof -ti tcp:%d 2>/dev/null", port))
      local pid_str = handle and handle:read("*l")
      if handle then handle:close() end
      local pid = tonumber(pid_str)
      if pid then
        os.execute(string.format("kill -TERM %d 2>/dev/null", pid))
        table.insert(restarted, { name = app.name, port = port, pid = pid })
      else
        table.insert(skipped, { name = app.name, port = port })
      end
    end
  end
  return json(200, { success = true, restarted = restarted, skipped = skipped, count = #restarted })
end

-- ── Catalog: name → start command registry ───────────────────────────────────

local function read_catalog()
  local f = io.open(catalogPath, "r")
  if not f then return {} end
  local raw = f:read("*a"); f:close()
  if not raw or raw == "" then return {} end
  local decoded = cjson.decode(raw)
  return type(decoded) == "table" and decoded or {}
end

local function write_catalog(catalog)
  os.execute("mkdir -p " .. runtimeDir)
  local tmp = catalogPath .. ".tmp"
  local f, err = io.open(tmp, "w")
  if not f then return nil, err end
  f:write(cjson.encode(catalog))
  f:close()
  return os.rename(tmp, catalogPath)
end

local function normalize_name(s)
  return tostring(s or ""):lower():match("^([a-z0-9][a-z0-9%-%_%.]*)")
end

local function list_catalog()
  if not is_local_request() then
    return json(403, { success = false, error = "Catalog is local-only." })
  end
  local catalog = read_catalog()
  local entries = {}
  for name, entry in pairs(catalog) do
    local e = type(entry) == "table" and entry or {}
    table.insert(entries, {
      name      = name,
      cmd       = e.cmd or "",
      cwd       = e.cwd or "",
      autoStart = e.autoStart ~= false,
    })
  end
  local count = #entries
  if count == 0 then entries = cjson.empty_array end
  return json(200, { success = true, catalog = entries, count = count })
end

local function upsert_catalog()
  if not is_local_request() then
    return json(403, { success = false, error = "Catalog is local-only." })
  end
  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  if not body or body == "" then
    return json(400, { success = false, error = "JSON body required." })
  end
  local req = cjson.decode(body)
  if not req or type(req) ~= "table" then
    return json(400, { success = false, error = "Invalid JSON." })
  end
  local name = normalize_name(req.name)
  if not name or name == "" then
    return json(400, { success = false, error = "name is required (alphanumeric, hyphens, dots)." })
  end
  local cmd = tostring(req.cmd or "")
  if cmd == "" then
    return json(400, { success = false, error = "cmd (start command) is required." })
  end
  local catalog = read_catalog()
  catalog[name] = {
    cmd       = cmd,
    cwd       = tostring(req.cwd or "~"),
    autoStart = req.autoStart ~= false,
  }
  local ok, err = write_catalog(catalog)
  if not ok then
    return json(500, { success = false, error = err or "Could not write catalog." })
  end
  return json(200, { success = true, name = name })
end

local function delete_catalog_entry()
  if not is_local_request() then
    return json(403, { success = false, error = "Catalog is local-only." })
  end
  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  if not body or body == "" then
    return json(400, { success = false, error = "JSON body required." })
  end
  local req = cjson.decode(body)
  if not req or not req.name then
    return json(400, { success = false, error = "name is required." })
  end
  local catalog = read_catalog()
  catalog[req.name] = nil
  local ok, err = write_catalog(catalog)
  if not ok then
    return json(500, { success = false, error = err or "Could not write catalog." })
  end
  return json(200, { success = true, name = req.name })
end

local function spawn_catalog_monad()
  if not is_local_request() then
    return json(403, { success = false, error = "Spawn is local-only." })
  end
  if ngx.req.get_method() ~= "POST" then
    return json(405, { success = false, error = "Use POST." })
  end
  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  local req  = body and cjson.decode(body) or {}
  local name = normalize_name(type(req) == "table" and req.name or "")
  if not name or name == "" then
    return json(400, { success = false, error = "name is required." })
  end
  local catalog = read_catalog()
  local entry   = catalog[name]
  if not entry then
    return json(404, { success = false, error = "Monad '" .. name .. "' not in catalog." })
  end
  local cmd = tostring(entry.cmd or "")
  if cmd == "" then
    return json(400, { success = false, error = "Catalog entry has no cmd." })
  end
  local home = os.getenv("HOME") or ""
  local cwd  = tostring(entry.cwd or home):gsub("^~", home)
  local log  = runtimeDir .. "/" .. name .. ".spawn.log"
  local full = string.format("cd %s && %s >> %s 2>&1 &", cwd, cmd, log)
  local h = io.popen(full)
  if h then h:close() end
  return json(200, { success = true, name = name, message = "Spawn signal sent." })
end

-- ── Frontend mode: per-app dev ↔ dist toggle ──────────────────────────────────
-- Generalizes the same dev/static-dist switch netget's own Main Server panel
-- has always had (mainServerFrontend.ts) to any registered app, addressed at
-- /apps/<name>/__frontend-mode. See setNginxConfigRoutes.ts for why this is a
-- generic regex location (works before any app-specific config exists) plus a
-- per-app exact-match override once an app is in dist mode.

local function normalize_token(value)
  local text = tostring(value or ""):lower()
  text = text:gsub("[^a-z0-9%._%-]+", "-")
  text = text:gsub("^%-+", ""):gsub("%-+$", "")
  return text
end

local function app_monad_name(app)
  local metadata = type(app.metadata) == "table" and app.metadata or {}
  local direct = normalize_token(metadata.monadName)
  if direct ~= "" then return direct end
  local name = tostring(app.name or "")
  name = name:gsub("^monad:", "")
  return normalize_token(name)
end

local function find_app_by_name(name)
  local wanted = normalize_token(ngx.unescape_uri(name or ""))
  if wanted == "" then return nil end
  local registry = read_registry()
  for _, app in pairs(registry.apps or {}) do
    if app_monad_name(app) == wanted or normalize_token(app.id) == wanted then
      return app
    end
  end
  return nil
end

local function file_exists(path)
  local f = io.open(path, "r")
  if not f then return false end
  f:close()
  return true
end

local function frontend_mode()
  if not is_local_request() then
    return json(403, { success = false, error = "Frontend mode is local-only until auth/policies are enabled." })
  end

  local name = ngx.var.apps_target
  local app = find_app_by_name(name)
  if not app then
    return json(404, { success = false, error = "App '" .. tostring(name) .. "' is not registered." })
  end

  if ngx.req.get_method() == "GET" then
    local meta = type(app.metadata) == "table" and app.metadata or {}
    return json(200, {
      success = true,
      name = name,
      frontendMode = app.frontendMode or "dev",
      distDir = meta.frontendDistDir,
    })
  end

  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  local req = body and cjson.decode(body) or nil
  local mode = req and tostring(req.mode or "") or ""
  if mode ~= "dev" and mode ~= "dist" then
    return json(400, { success = false, error = "Invalid mode: \"" .. mode .. "\". Use dev or dist." })
  end

  local meta = type(app.metadata) == "table" and app.metadata or {}
  local distDir = tostring(meta.frontendDistDir or "")
  if mode == "dist" then
    if distDir == "" or not file_exists(distDir .. "/index.html") then
      return json(400, {
        success = false,
        error = "No built dist found at " .. (distDir ~= "" and distDir or "(unreported)")
          .. "/index.html — run the app's build first.",
      })
    end
  end

  local registry = read_registry()
  local id = app.id
  if not registry.apps[id] then
    return json(404, { success = false, error = "App '" .. tostring(name) .. "' is no longer registered." })
  end
  registry.apps[id].frontendMode = mode

  local ok, err = write_registry(registry)
  if not ok then
    return json(500, { success = false, error = err or "Could not write app registry." })
  end

  return json(200, { success = true, name = name, frontendMode = mode })
end

local action = ngx.var.apps_action
if action == "report" then
  return report_app()
elseif action == "list" then
  return list_apps()
elseif action == "release" then
  return release_app()
elseif action == "restart_all" then
  return restart_all()
elseif action == "catalog_list" then
  return list_catalog()
elseif action == "catalog_upsert" then
  return upsert_catalog()
elseif action == "catalog_delete" then
  return delete_catalog_entry()
elseif action == "catalog_spawn" then
  return spawn_catalog_monad()
elseif action == "frontend_mode" then
  return frontend_mode()
end

return json(404, { success = false, error = "Unknown apps action." })
