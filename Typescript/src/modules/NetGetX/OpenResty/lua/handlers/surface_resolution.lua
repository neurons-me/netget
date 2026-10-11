-- Slice 2: read-only report of what this netget knows about its own
-- network — see src/types/SurfaceResolution.ts for the documented
-- contract. Two distinct layers, not one flat domain list (see Slice 1's
-- WelcomeNetget.jsx fix for why conflating them was actively misleading):
--
--   entrypoints — doors into THIS netget's own resolver. Never monad-
--   resolved. localhost and 127.0.0.1 are listed only to a peer that is ON
--   this machine: for anyone else they name THEIR OWN machine, not this
--   server (a visitor on the LAN included), so presenting them as a way into
--   this netget would send them to the wrong place. The public main server
--   is listed only if one is configured. local.netget is NOT listed: that
--   alias was retired from the admin block (only localhost/127.0.0.1 answer
--   there), so listing it advertised a name that does not resolve.
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

local function optional_string(value)
  if type(value) == "string" then return value end
  return ""
end

local function is_control_entrypoint(host)
  if host == "" then return true end
  if host == "localhost" or host == "127.0.0.1" or host == "local.netget" then return true end
  if _G.MAIN_SERVER_NAME and host == _G.MAIN_SERVER_NAME then return true end
  return false
end

-- Is the peer a process on THIS machine? Loopback only: a peer on the LAN reaches this server by an address of its
-- own, and `localhost` on its side is its own machine.
local function is_loopback_peer()
  local ip = ngx.var.remote_addr or ""
  if ip == "::1" or ip == "unix:" then return true end
  return ip:match("^127%.%d+%.%d+%.%d+$") ~= nil
end

local function list_entrypoints()
  set_json()
  local entrypoints = {}
  if is_loopback_peer() then
    table.insert(entrypoints, { id = "localhost", host = "localhost", kind = "loopback", status = "local_only" })
    table.insert(entrypoints, { id = "127.0.0.1", host = "127.0.0.1", kind = "loopback", status = "local_only" })
  end

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

  -- An empty Lua table encodes as {} (an object); the answer's contract is a list, and a client that reads a non-list
  -- as "did not answer" would call a legitimately empty list unavailable.
  if #entrypoints == 0 then entrypoints = cjson.empty_array end
  ngx.say(cjson.encode({ success = true, entrypoints = entrypoints }))
end

-- status rule for a registered domain, using only fields already on record
-- (no live DNS/cert audit — see AGENTS.md Slice 2 scope):
--   sslMode off/none/empty              -> active (http-only, working)
--   sslMode set, cert paths on record   -> active
--   sslMode set, no cert paths yet      -> pending_cert
local function surface_status(row)
  local sslMode = string.lower(optional_string(row.sslMode))
  if sslMode == "" or sslMode == "off" or sslMode == "none" then
    return "active"
  end
  local hasCert = optional_string(row.sslCertificate) ~= ""
    and optional_string(row.sslCertificateKey) ~= ""
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
    local domain = optional_string(row.domain)
    local subdomain = optional_string(row.subdomain)
    local publicHost = domain
    if subdomain ~= "" and subdomain ~= domain then
      publicHost = subdomain .. "." .. domain
    end

    if not is_control_entrypoint(publicHost) then
      local sslMode = string.lower(optional_string(row.sslMode))
      local httpsCapable = sslMode ~= "" and sslMode ~= "off" and sslMode ~= "none"
      table.insert(surfaces, {
        id = "domain." .. publicHost,
        kind = "domain",
        publicHost = publicHost,
        status = surface_status(row),
        httpsCapable = httpsCapable,
      })
    end
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
