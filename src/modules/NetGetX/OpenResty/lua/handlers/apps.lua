local cjson = require "cjson.safe"

local function getNetgetDataDir()
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return os.getenv("HOME") .. "/.get"
end

local netgetDir = getNetgetDataDir()
local runtimeDir = netgetDir .. "/runtime"
local appsPath = runtimeDir .. "/apps.json"

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

  return json(200, { success = true, apps = apps, count = #apps, updatedAt = registry.updatedAt })
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

local action = ngx.var.apps_action
if action == "report" then
  return report_app()
elseif action == "list" then
  return list_apps()
elseif action == "release" then
  return release_app()
end

return json(404, { success = false, error = "Unknown apps action." })
