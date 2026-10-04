-- lua/handlers/networks.lua
-- REST handler for /networks implementing CRUD similar to Express version
local cjson = require('cjson')
local db = require('lib.networks_db')
local operator = require('lib.operator_access')

ngx.header.content_type = 'application/json; charset=utf-8'
ngx.header['Access-Control-Allow-Origin'] = ngx.var.http_origin or '*'
ngx.header['Access-Control-Allow-Credentials'] = 'true'

-- All of /networks is local-only (lib/operator_access.lua's own reasoning:
-- a Host header or "it arrived over http" proves nothing about the caller).
-- Reads stay gated by that alone, matching /apps GET and /openresty-status's
-- own precedent. Mutations (below) additionally require a real signed
-- X-Me-Proof + an explicit capability grant.
--
-- Found live 2026-10-03 (same audit pass as the catalog/apps-registry
-- fixes): this handler previously had NO authorization of its own at all --
-- not even is_local_request(), unlike openresty.lua/dev_server.lua, which
-- at least had that. It relied entirely on nginx's limit_except, which (see
-- setNginxConfigRoutes.ts's own comment on this location) does not actually
-- restrict GET/HEAD and, separately, breaks content_by_lua_file for any
-- excluded method regardless of peer -- the same bug already fixed on
-- /openresty-restart etc. A second, unrelated bug (try_files shadowing
-- content_by_lua_file entirely) currently makes this whole handler
-- unreachable in practice; that is a routing bug, deliberately left alone
-- here so fixing it doesn't momentarily expose an unauthorized handler --
-- authorization goes in first.
if not operator.is_loopback() then
  ngx.status = 403
  ngx.say(cjson.encode({ success = false, error = 'Networks API is local-only.' }))
  return
end

local NETWORKS_WRITE_CAPABILITY = 'gateway:control:networks-write'

-- Verifies a real X-Me-Proof and the networks-write capability before a
-- mutation proceeds. middleware/me_sig.lua is loaded fresh via loadfile()()
-- -- NOT require(), which would cache the module and skip verification on
-- every request after the first in this worker (see that file's own
-- "Claims loader" section, and the same reasoning setNginxConfigRoutes.ts
-- uses for /domains/metadata and /openresty-restart's controlActionGate).
-- me_sig.lua's own deny() already sends 401 and ngx.exit()s outright if the
-- proof is missing, invalid, expired, or a replayed nonce -- reaching the
-- capability check below means a real, fresh, request-bound proof was
-- already presented. $NETGET_LUA_DIR is set by this location in
-- setNginxConfigRoutes.ts (Lua here has no access to the TS-side
-- layout.luaDir the generator itself uses for its own inline
-- access_by_lua_block calls).
local function require_write_capability()
  local me_sig_chunk = loadfile(ngx.var.NETGET_LUA_DIR .. "/middleware/me_sig.lua")
  me_sig_chunk()
  if not operator.has_capability(NETWORKS_WRITE_CAPABILITY) then
    ngx.status = 403
    ngx.say(cjson.encode({ success = false, error = 'CAPABILITY_DENIED', required = NETWORKS_WRITE_CAPABILITY }))
    return false
  end
  return true
end

local function read_body_json()
  ngx.req.read_body()
  local data = ngx.req.get_body_data()
  if not data then
    local file_name = ngx.req.get_body_file()
    if file_name then
      local f = io.open(file_name, 'r')
      if f then data = f:read('*a'); f:close() end
    end
  end
  if not data or data == '' then return nil end
  local ok, obj = pcall(cjson.decode, data)
  if not ok then return nil end
  return obj
end

local uri = ngx.var.uri or ''
local method = ngx.req.get_method()

-- Route resolution
-- /networks, /networks/count, /networks/migrate, /networks/:name
if uri == '/networks' then
  if method == 'GET' then
    local list = db.get_all_networks()
    return ngx.say(cjson.encode({ success = true, networks = list }))
  elseif method == 'POST' then
    if not require_write_capability() then return end
    local body = read_body_json() or {}
    local name, ip, owner = body.name, body.ip, body.owner
    if not name or not ip or not owner then
      ngx.status = 400
      return ngx.say(cjson.encode({ success=false, error='Missing required fields: name, ip, and owner are required' }))
    end
    local obj, err = db.add_network(name, ip, owner)
    if not obj then
      if err and err:find('already exists', 1, true) then
        ngx.status = 409
      else
        ngx.status = 500
      end
      return ngx.say(cjson.encode({ success=false, error= err or 'Failed to add network' }))
    end
    ngx.status = 201
    return ngx.say(cjson.encode({ success=true, network = obj }))
  else
    ngx.status = 405; return ngx.say(cjson.encode({error='Method Not Allowed'}))
  end
elseif uri == '/networks/count' and method == 'GET' then
  local count = db.get_networks_count()
  return ngx.say(cjson.encode({ success = true, count = count }))
elseif uri == '/networks/migrate' and method == 'POST' then
  if not require_write_capability() then return end
  local body = read_body_json() or {}
  local migrated = db.migrate_from_localstorage(body)
  return ngx.say(cjson.encode({ success = true, message = string.format('Successfully migrated %d networks', #migrated), networks = migrated }))
else
  -- Try match /networks/:name
  local m, err = ngx.re.match(uri, [[^/networks/(.+)$]], 'jo')
  if m and m[1] then
    local encoded = m[1]
    local ok_dec, name = pcall(ngx.unescape_uri, encoded)
    name = ok_dec and name or encoded
    if method == 'GET' then
      local n = db.get_network_by_name(name)
      if not n then ngx.status = 404; return ngx.say(cjson.encode({ success=false, error='Network not found' })) end
      return ngx.say(cjson.encode({ success = true, network = n }))
    elseif method == 'PUT' then
      if not require_write_capability() then return end
      local updates = read_body_json() or {}
      local updated, e = db.update_network(name, updates)
      if not updated then ngx.status = 404; return ngx.say(cjson.encode({ success=false, error='Failed to update network' })) end
      return ngx.say(cjson.encode({ success = true, network = updated }))
    elseif method == 'DELETE' then
      if not require_write_capability() then return end
      local deleted = db.delete_network(name)
      if not deleted then ngx.status = 404; return ngx.say(cjson.encode({ success=false, error='Network not found' })) end
      return ngx.say(cjson.encode({ success = true, message = 'Network deleted successfully' }))
    else
      ngx.status = 405; return ngx.say(cjson.encode({error='Method Not Allowed'}))
    end
  end
end

ngx.status = 404
ngx.say(cjson.encode({ error = 'Not Found' }))
