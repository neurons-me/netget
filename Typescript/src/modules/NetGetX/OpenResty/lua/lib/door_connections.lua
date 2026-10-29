-- lib/door_connections.lua -- the connections a door declares (see src/runtime/doorConnections.ts for the model).
--
-- A door is a domain record. Its main destination answers everything the record does not carve out; a connection
-- carves out one path prefix and sends it to a service of the app that is not a monad (FullTrailer's own server).
--
-- Used by surface_proxy.lua (the host door) and monad_proxy.lua (the /apps/<name>/ door). The declaration was already
-- checked when it was written (doorConnections.ts); it is checked AGAIN here, because what arrives is
-- domain-map.json -- a file -- and a file is not an authority. A connection that fails any rule below is not
-- applied, and a request that would have matched it is answered with an error: it never falls through to the
-- monad or to the app's HTML, which would answer an API call with a page.
--
-- Pure: no ngx calls, so it can be tested without nginx.
local M = {}

-- Ports that belong to the gateway itself. Never a target.
local RESERVED_PORTS = { [80] = true, [443] = true, [3000] = true }

-- Paths the gateway or the monad answer. A connection may not sit on them or above them.
local RESERVED_PREFIXES = {
  "/api/v1", "/claims", "/me", "/.me", "/.mesh", "/.monads", "/.well-known",
  "/apps", "/monads", "/domains", "/gateway-identity", "/setup", "/admin-session", "/main-server-namespace",
  "/openresty-status", "/openresty-restart", "/openresty-stop", "/frontend-mode", "/entrypoints", "/surfaces",
  "/add-domain", "/delete-domain", "/provision-cert", "/check-auth", "/explain", "/inspect", "/cleaker",
  "/ip-info", "/port-info", "/healthcheck", "/logs", "/resolve", "/__surface", "/__provider", "/__gateway",
  "/assets", "/health", "/status",
}

local function starts_with(s, p) return s:sub(1, #p) == p end

-- Does `path` belong to `prefix`? "/api/fuel" and "/api/fuel/1" do; "/api/fuelAnything" and "/api" do not.
function M.path_matches(path, prefix)
  if type(path) ~= "string" or type(prefix) ~= "string" or prefix == "" then return false end
  return path == prefix or starts_with(path, prefix .. "/")
end

local function prefix_ok(prefix)
  if type(prefix) ~= "string" then return false, "prefix is not a string" end
  if #prefix < 2 or #prefix > 128 then return false, "prefix length" end
  if prefix:sub(1, 1) ~= "/" or prefix:sub(-1) == "/" then return false, "prefix shape" end
  if not prefix:match("^[%w%._~%-/]+$") then return false, "prefix characters" end
  if prefix:find("//", 1, true) then return false, "empty segment" end
  for seg in prefix:gmatch("[^/]+") do
    if seg == "." or seg == ".." then return false, "dot segment" end
  end
  for _, reserved in ipairs(RESERVED_PREFIXES) do
    if prefix == reserved or starts_with(prefix, reserved .. "/") or starts_with(reserved, prefix .. "/") then
      return false, "overlaps " .. reserved
    end
  end
  return true
end

-- Ports of the monads that are registered: a monad is reached by `app:<name>`, through the door's selection, never
-- by its port (a port would skip the Host forcing and the identity of the selection).
local function registered_ports(registry)
  local ports = {}
  if type(registry) ~= "table" or type(registry.apps) ~= "table" then return ports end
  for _, app in pairs(registry.apps) do
    -- an APP entry is not a monad: its own server is exactly what a connection points at, so only monads are refused
    if type(app) == "table" and app.kind ~= "app" then
      local p = tonumber(app.port)
      if p then ports[p] = true end
      local meta = type(app.metadata) == "table" and app.metadata or {}
      for _, key in ipairs({ "endpoint", "directEndpoint", "controlEndpoint" }) do
        local ep = tostring(meta[key] or "")
        local ep_port = ep:match(":(%d+)/?$")
        if ep_port then ports[tonumber(ep_port)] = true end
      end
    end
  end
  return ports
end

-- A declared connection as an upstream URL, or (nil, why). `registry` is apps.json decoded (may be nil).
function M.upstream(connection, registry)
  if type(connection) ~= "table" then return nil, "not a connection" end
  local ok, why = prefix_ok(connection.prefix)
  if not ok then return nil, why end

  local target = tostring(connection.target or ""):gsub("^%s+", ""):gsub("%s+$", "")
  target = target:gsub("^[Hh][Tt][Tt][Pp]://", "")
  local host, port = target:match("^([%w%.]+):(%d+)$")
  if not host then return nil, "target shape" end
  host = host:lower()
  if host ~= "127.0.0.1" and host ~= "localhost" then return nil, "target is not loopback" end
  port = tonumber(port)
  if not port or port < 1024 or port > 65535 then return nil, "target port range" end
  if RESERVED_PORTS[port] then return nil, "target port belongs to the gateway" end
  if registered_ports(registry)[port] then return nil, "target port is a registered monad" end
  return "http://127.0.0.1:" .. tostring(port)
end

-- The connection of `connections` (a list) that answers `path`: the longest matching prefix, or nil.
function M.match(connections, path)
  if type(connections) ~= "table" then return nil end
  local best
  for _, c in ipairs(connections) do
    if type(c) == "table" and M.path_matches(path, c.prefix) then
      if not best or #c.prefix > #best.prefix then best = c end
    end
  end
  return best
end

-- The decision for one request. Returns:
--   nil                      the door's main destination answers (no connection matches)
--   { upstream = "http://127.0.0.1:4000", prefix = "/api/fuel" }
--   { error = "...", prefix = "/api/fuel" }   a connection matches but is not allowed to be applied
function M.decide(connections, path, registry)
  local c = M.match(connections, path)
  if not c then return nil end
  local upstream, why = M.upstream(c, registry)
  if not upstream then return { error = why, prefix = c.prefix } end
  return { upstream = upstream, prefix = c.prefix }
end

-- Who may use a connection. A service behind a connection is the app's OWN server and usually has no authentication of
-- its own (FullTrailer's: /api/fuel, /api/upload and /uploads answer anyone who reaches them). What stops a stranger is
-- therefore the gateway: a connection follows the exposure policy the operator set for the app (the same rules
-- /apps/<name>/ applies to the monad: enabled, visibility loopback|lan|wan, network.allowLoopback|allowLan|allowWan),
-- judged on the address that connected to nginx and never on a forwarded header. An app with no policy is judged as
-- `visibility = loopback` (fail closed). A `guest`-trust app has no connections.
--   returns true, nil          allowed
--   returns false, <status>    refused (404 when the app is disabled, otherwise 403)
local function is_loopback_ip(ip) return ip == "127.0.0.1" or ip == "::1" or ip == "unix:" end
local function is_lan_ip(ip)
  if is_loopback_ip(ip) then return true end
  if ip:match("^10%.") or ip:match("^192%.168%.") or ip:match("^169%.254%.") then return true end
  local second = tonumber(ip:match("^172%.(%d+)%."))
  if second and second >= 16 and second <= 31 then return true end
  if ip:match("^fe80:") or ip:match("^fd") then return true end
  return false
end

function M.exposure_allows(app, remote_addr)
  local remote = tostring(remote_addr or "")
  local entry = type(app) == "table" and app or {}
  if tostring(entry.trust or "") == "guest" then return false, 403 end
  local exposure = type(entry.exposure) == "table" and entry.exposure or {}
  if exposure.enabled == false then return false, 404 end
  local visibility = tostring(exposure.visibility or "loopback")
  local network = type(exposure.network) == "table" and exposure.network or {}
  if is_loopback_ip(remote) then return network.allowLoopback ~= false, 403 end
  if visibility == "loopback" then return false, 403 end
  if visibility == "lan" then return (is_lan_ip(remote) and network.allowLan ~= false) or false, 403 end
  if visibility == "wan" then return network.allowWan ~= false, 403 end
  return false, 403
end

-- What the app DECLARED about authorization (its exposure policy's `auth` block: requiredForRead,
-- requiredForDestructive, mode: "session", rolesAllowed) is a requirement on the operation, not a hint. A connection
-- cannot verify a session or a role yet (a proof for a multipart upload is not built), so the gateway does not
-- pretend to: an operation whose declared requirement cannot be checked is REFUSED, whatever the peer's address is.
-- Loopback is where a request comes from, not who it is.
--   * a read (GET/HEAD/OPTIONS) is refused when `auth.requiredForRead == true`;
--   * anything else (POST/PUT/PATCH/DELETE: it changes something) is refused unless the app explicitly declared
--     `auth.requiredForDestructive == false`. No declaration = required (fail closed).
--   returns true            allowed
--   returns false, "authorization_required"
local READ_METHODS = { GET = true, HEAD = true, OPTIONS = true }
function M.authorization_allows(app, method)
  local exposure = type(app) == "table" and type(app.exposure) == "table" and app.exposure or {}
  local auth = type(exposure.auth) == "table" and exposure.auth or {}
  local verb = tostring(method or ""):upper()
  if READ_METHODS[verb] then
    if auth.requiredForRead == true then return false, "authorization_required" end
    return true
  end
  if auth.requiredForDestructive == false then return true end
  return false, "authorization_required"
end

-- Connections of the domain-map route whose destination is `app:<name>` (the /apps/<name>/ door), or {}.
-- A host can have one record; if several records point at the same app, the first one with connections (in host
-- name order, so the answer does not depend on table iteration order) is used.
function M.for_app(domain_map, app_name)
  if type(domain_map) ~= "table" or type(domain_map.domains) ~= "table" then return {} end
  local want = "app:" .. tostring(app_name or ""):lower()
  local hosts = {}
  for host, route in pairs(domain_map.domains) do
    if type(route) == "table" and type(route.target) == "string" and route.target:lower() == want
       and type(route.connections) == "table" and #route.connections > 0 then
      hosts[#hosts + 1] = host
    end
  end
  table.sort(hosts)
  if #hosts == 0 then return {} end
  return domain_map.domains[hosts[1]].connections
end

return M
