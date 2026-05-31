-- lua/lib/networks_db.lua
-- Lightweight file-based replacement for sqlite-backed networks DB
-- Persists to /opt/.get/networks.json to mirror prior location semantics.
local cjson = require('cjson')

local M = {}

local CONFIG_DIR = "/opt/.get"
local NETWORKS_FILE = CONFIG_DIR .. "/networks.json"

local function ensure_config_dir()
  -- best-effort mkdir -p
  os.execute(string.format('mkdir -p %q', CONFIG_DIR))
end

local function read_file(path)
  local f = io.open(path, 'r')
  if not f then return nil end
  local content = f:read('*a')
  f:close()
  return content
end

local function write_file(path, data)
  local f, err = io.open(path, 'w')
  if not f then return nil, err end
  f:write(data)
  f:close()
  return true
end

local function load_all()
  ensure_config_dir()
  local raw = read_file(NETWORKS_FILE)
  if not raw or raw == '' then return {} end
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == 'table' then return decoded end
  return {}
end

local function save_all(tbl)
  ensure_config_dir()
  local ok, encoded = pcall(cjson.encode, tbl)
  if not ok then return nil, 'encode error' end
  return write_file(NETWORKS_FILE, encoded)
end

-- Public API mirrors JS utils
function M.get_all_networks()
  local data = load_all()
  table.sort(data, function(a,b)
    return (a.created_at or '') > (b.created_at or '')
  end)
  return data
end

local function find_by_name(data, name)
  for i, n in ipairs(data) do
    if n.name == name then return i, n end
  end
  return nil, nil
end

function M.get_network_by_name(name)
  local data = load_all()
  local _, n = find_by_name(data, name)
  return n
end

function M.add_network(name, ip, owner)
  local data = load_all()
  local _, exists = find_by_name(data, name)
  if exists then
    return nil, string.format('A network with the name "%s" already exists.', name)
  end
  local now = os.date('!%Y-%m-%dT%H:%M:%SZ')
  local obj = { id = ngx.time(), name = name, ip = ip, owner = owner, created_at = now, updated_at = now }
  table.insert(data, obj)
  local ok, err = save_all(data)
  if not ok then return nil, err end
  return obj
end

function M.update_network(name, updates)
  local data = load_all()
  local idx, obj = find_by_name(data, name)
  if not obj then return nil, 'not found' end
  local allowed = { name=true, ip=true, owner=true }
  for k, v in pairs(updates or {}) do
    if allowed[k] ~= nil then obj[k] = v end
  end
  obj.updated_at = os.date('!%Y-%m-%dT%H:%M:%SZ')
  data[idx] = obj
  local ok, err = save_all(data)
  if not ok then return nil, err end
  local final_name = updates and updates.name or name
  return M.get_network_by_name(final_name)
end

function M.delete_network(name)
  local data = load_all()
  local idx = nil
  for i, n in ipairs(data) do
    if n.name == name then idx = i; break end
  end
  if not idx then return false end
  table.remove(data, idx)
  save_all(data)
  return true
end

function M.get_networks_count()
  local data = load_all()
  return #data
end

function M.migrate_from_localstorage(networksData)
  local migrated = {}
  if not networksData or type(networksData.networks) ~= 'table' then
    return migrated
  end
  for name, info in pairs(networksData.networks) do
    local ok_obj, err = M.add_network(name, info.ip, info.owner)
    if ok_obj then table.insert(migrated, ok_obj) end
  end
  return migrated
end

return M
