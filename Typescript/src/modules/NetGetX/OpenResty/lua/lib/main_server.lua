-- main_server.lua -- the gateway's main server, as netget derives it from the namespace.
--
-- The namespace declares its main server (netget.main.server.name); netget reads that,
-- makes the doors, and writes runtime/main-server.json (mainServerEntry.ts):
--
--   { namespace = "cleaker.me",
--     declared  = { name = "netget.site", status = "valid" },
--     doors     = { { name = "netget.site", reachable = "ok", tls = "present" }, ... },
--     active    = "netget.site" }
--
-- A door is a host that ENTERS the namespace: a request for <door>/<path> is the
-- namespace's <path>, exactly as <namespace>/<path> is. This module answers, for a
-- request's host, whether it is a door and which namespace it enters -- from that
-- generated file, not from a name baked into nginx.conf. The file is re-read at most
-- once a second per worker, and a file that cannot be read or parsed leaves the last good
-- state in place: a bad write never takes the gateway's main server away.

local cjson = require "cjson.safe"

local M = {}

local REFRESH_SECONDS = 1
local cache = { at = -1, state = nil }

local function data_dir()
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return (os.getenv("HOME") or "") .. "/.get"
end

local function normalize(host)
  local h = tostring(host or ""):lower()
  return h:match("^([^:]+)") or h
end

local function refresh()
  local now = ngx.now()
  if cache.at >= 0 and (now - cache.at) < REFRESH_SECONDS then return cache.state end
  cache.at = now
  local f = io.open(data_dir() .. "/runtime/main-server.json", "r")
  if not f then return cache.state end
  local raw = f:read("*a")
  f:close()
  local decoded = cjson.decode(raw)
  if type(decoded) == "table" then cache.state = decoded end
  return cache.state
end

--- The derived state, or nil when netget has not derived one (an older installation).
function M.state()
  return refresh()
end

--- True when `host` is one of the doors into the namespace.
function M.is_door(host)
  local state = refresh()
  if not state or type(state.doors) ~= "table" then return false end
  local target = normalize(host)
  for _, door in ipairs(state.doors) do
    if type(door) == "table" and normalize(door.name) == target then return true end
  end
  return false
end

--- The namespace `host` enters when it is a door, else nil.
function M.door_namespace(host)
  local state = refresh()
  if state and type(state.namespace) == "string" and state.namespace ~= "" and M.is_door(host) then
    return state.namespace
  end
  return nil
end

--- The host the gateway treats as its main server: the active door; without derived
--- state, the name nginx.conf was generated with (older installations); else "".
function M.name()
  local state = refresh()
  if state and type(state.active) == "string" and state.active ~= "" then return state.active end
  return _G.MAIN_SERVER_NAME or ""
end

return M
