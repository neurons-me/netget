-- Slice 2: read-only report of what this netget knows about its own
-- network — see src/types/SurfaceResolution.ts for the documented
-- contract. Two distinct layers, not one flat domain list (see Slice 1's
-- WelcomeNetget.jsx fix for why conflating them was actively misleading):
--
--   entrypoints — doors into THIS netget's own resolver. Never monad-
--   resolved; localhost/127.0.0.1/local.netget always exist, the public
--   main server only if one is configured.
--
--   surfaces — real registered domains, each one a monad-resolved app.
--
-- No writes, no monad, no .me kernel — see AGENTS.md Slice 2 scope.

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
local sqliteDatabasePath = netgetDir .. "/domains.db"

local function set_json()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function exec_sql(query)
  local cmd = string.format("sqlite3 -json '%s' \"%s\"", sqliteDatabasePath, query)
  local f = io.popen(cmd)
  if not f then return nil end
  local out = f:read("*a")
  f:close()
  return out
end

local function list_entrypoints()
  set_json()
  local entrypoints = {
    { id = "localhost", host = "localhost", kind = "loopback", status = "local_only" },
    { id = "127.0.0.1", host = "127.0.0.1", kind = "loopback", status = "local_only" },
    { id = "local.netget", host = "local.netget", kind = "lan", status = "local_only" },
  }

  -- _G.MAIN_SERVER_NAME is set once per worker in the main nginx.conf's
  -- init_worker_by_lua_block (see setNginxConfigFile.ts) and shared across
  -- every included server block in this worker's Lua VM — same mechanism
  -- @mesh_gateway_error already relies on for _G.render_gateway_status.
  local mainServerName = _G.MAIN_SERVER_NAME
  if mainServerName and mainServerName ~= "" then
    table.insert(entrypoints, {
      id = mainServerName,
      host = mainServerName,
      kind = "public",
      status = "active",
    })
  end

  ngx.say(cjson.encode({ success = true, entrypoints = entrypoints }))
end

-- status rule for a registered domain, using only fields already on record
-- (no live DNS/cert audit — see AGENTS.md Slice 2 scope):
--   sslMode off/none/empty              -> active (http-only, working)
--   sslMode set, cert paths on record   -> active
--   sslMode set, no cert paths yet      -> pending_cert
local function surface_status(row)
  local sslMode = string.lower(row.sslMode or "")
  if sslMode == "" or sslMode == "off" or sslMode == "none" then
    return "active"
  end
  local hasCert = (row.sslCertificate and row.sslCertificate ~= "")
    and (row.sslCertificateKey and row.sslCertificateKey ~= "")
  if hasCert then return "active" end
  return "pending_cert"
end

local function list_surfaces()
  set_json()
  local out = exec_sql("SELECT domain, subdomain, sslMode, sslCertificate, sslCertificateKey FROM domains")
  if not out or out == "" then out = "[]" end
  local ok, rows = pcall(cjson.decode, out)
  if not ok or not rows then rows = {} end

  local surfaces = {}
  for _, row in ipairs(rows) do
    local publicHost = row.domain
    if row.subdomain and row.subdomain ~= "" and row.subdomain ~= row.domain then
      publicHost = row.subdomain .. "." .. row.domain
    end
    local sslMode = string.lower(row.sslMode or "")
    local httpsCapable = sslMode ~= "" and sslMode ~= "off" and sslMode ~= "none"
    table.insert(surfaces, {
      id = "domain." .. publicHost,
      kind = "domain",
      publicHost = publicHost,
      status = surface_status(row),
      httpsCapable = httpsCapable,
    })
  end
  if #surfaces == 0 then surfaces = cjson.empty_array end

  ngx.say(cjson.encode({ success = true, surfaces = surfaces }))
end

local action = ngx.var.surface_resolution_action
if action == "entrypoints" then
  return list_entrypoints()
elseif action == "surfaces" then
  return list_surfaces()
else
  set_json()
  ngx.status = 404
  ngx.say(cjson.encode({ error = "Unknown surface_resolution action" }))
end
