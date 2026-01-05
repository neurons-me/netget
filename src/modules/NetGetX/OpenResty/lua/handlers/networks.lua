-- lua/handlers/networks.lua
-- REST handler for /networks implementing CRUD similar to Express version
local cjson = require('cjson')
local db = require('lib.networks_db')

ngx.header.content_type = 'application/json; charset=utf-8'
ngx.header['Access-Control-Allow-Origin'] = ngx.var.http_origin or '*'
ngx.header['Access-Control-Allow-Credentials'] = 'true'

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
      local updates = read_body_json() or {}
      local updated, e = db.update_network(name, updates)
      if not updated then ngx.status = 404; return ngx.say(cjson.encode({ success=false, error='Failed to update network' })) end
      return ngx.say(cjson.encode({ success = true, network = updated }))
    elseif method == 'DELETE' then
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
