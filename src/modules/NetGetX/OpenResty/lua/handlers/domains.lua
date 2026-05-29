local cjson = require "cjson.safe"
local jwt = require "resty.jwt"
local ck = require "resty.cookie"


local JWT_SECRET = os.getenv("JWT_SECRET") or "dev_secret"
local function getNetgetDataDir()
  -- Prefer env, fallback to nginx var, finally default to ~/.get
  local env_dir = os.getenv("NETGET_DATA_DIR")
  if env_dir and env_dir ~= "" then return env_dir end
  if ngx and ngx.var and ngx.var.NETGET_DATA_DIR and ngx.var.NETGET_DATA_DIR ~= "" then
    return ngx.var.NETGET_DATA_DIR
  end
  return os.getenv("HOME") .. "/.get"
end

local netgetDir          = getNetgetDataDir()
local sqliteDatabasePath = netgetDir .. "/domains.db"
local domainMapPath      = netgetDir .. "/runtime/domain-map.json"
local domainMapVersion   = netgetDir .. "/runtime/domain-map.version"

local function set_json()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function auth_required()
  -- Skip auth for HTTP (local development / loopback)
  local scheme = ngx.var.scheme or "http"
  if scheme ~= "https" then
    ngx.log(ngx.INFO, "Skipping auth for HTTP connection in domains.lua")
    return true
  end

  -- For HTTPS, require JWT token (legacy — will migrate to Ed25519 proof auth)
  local cookie = ck:new()
  local token = cookie:get("token")
  if not token then return false end
  local obj = jwt:verify(JWT_SECRET, token)
  return obj and obj.verified
end

local function read_body_json()
  ngx.req.read_body()
  local data = ngx.req.get_body_data()
  if not data then return {} end
  local obj = cjson.decode(data)
  return obj or {}
end

-- naive sqlite access via shell (requires sqlite3 CLI installed).
local function exec_sql(query, params)
  if params then
    for _, p in ipairs(params) do
      local safe = tostring(p):gsub("'", "''")
      query = query:gsub("?", "'" .. safe .. "'", 1)
    end
  end
  local cmd = string.format("sqlite3 -json '%s' \"%s\"", sqliteDatabasePath, query)
  local f = io.popen(cmd)
  if not f then return nil, "sqlite popen failed" end
  local out = f:read("*a")
  f:close()
  return out
end

-- Bump domain-map.version so Lua routing workers hot-reload the map.
-- The actual domain-map.json re-generation happens in the TypeScript layer
-- (domainMap.ts generateDomainMap()); here we just signal a version change
-- so the next netget process call regenerates it.
local function bump_domain_map_version()
  local ts = tostring(ngx.now() * 1000)
  local f = io.open(domainMapVersion, "w")
  if f then f:write(ts); f:close() end
end

local function list_domains()
  local sql = "SELECT domain, subdomain, email, sslMode, target, type, projectPath, owner FROM domains"
  local out = exec_sql(sql)
  if not out or out == "" then out = "[]" end
  local domains = cjson.decode(out) or {}
  if #domains == 0 then domains = cjson.empty_array end
  ngx.say(cjson.encode({ success = true, domains = domains, count = #domains }))
end

local function list_subdomains(parent)
  local sql = "SELECT domain, subdomain, email, sslMode, target, type, projectPath, owner FROM domains WHERE subdomain = ? AND domain != ?"
  local out = exec_sql(sql, { parent, parent })
  if not out or out == "" then out = "[]" end
  local subdomains = cjson.decode(out) or {}
  ngx.say(cjson.encode({ subdomains = subdomains }))
end

local function get_domain_target(domain)
  if not domain or domain == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "Missing domain" }))
    return
  end
  local sql = "SELECT target FROM domains WHERE domain = ? LIMIT 1"
  local out = exec_sql(sql, { domain })
  if not out or out == "" or out == "[]" then
    ngx.status = 404
    ngx.say(cjson.encode({ error = "Domain not found" }))
    return
  end
  local decoded = cjson.decode(out)
  local target = decoded and decoded[1] and decoded[1].target or nil
  ngx.say(cjson.encode({ domain = domain, target = target }))
end

local function add_domain()
  local body = read_body_json()
  -- Only domain and target are required — email and owner default gracefully.
  if not body.domain or body.domain == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "domain is required" }))
    return
  end
  if not body.target or body.target == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "target is required" }))
    return
  end
  -- check exists
  local check = exec_sql("SELECT domain FROM domains WHERE domain = ?", { body.domain })
  if check and check ~= "" and check ~= "[]" then
    ngx.status = 409
    ngx.say(cjson.encode({ error = "Domain already exists" }))
    return
  end
  local sql = [[INSERT INTO domains (domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)]]
  local params = {
    body.domain,
    body.subdomain or '',
    body.email or '',
    body.sslMode or 'none',
    body.sslCertificate or '',
    body.sslCertificateKey or '',
    body.target,
    body.type or 'proxy',
    body.projectPath or '',
    body.owner or '',
  }
  exec_sql(sql, params)
  bump_domain_map_version()
  ngx.say(cjson.encode({ success = true, domain = body.domain }))
end

local function update_domain()
  local body = read_body_json()
  if not body.domain or not body.updatedFields then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "domain and updatedFields are required" }))
    return
  end
  local updates = {}
  local params = {}
  for k, v in pairs(body.updatedFields) do
    table.insert(updates, k .. " = ?")
    table.insert(params, v)
  end
  table.insert(params, body.domain)
  local sql = string.format("UPDATE domains SET %s WHERE domain = ?", table.concat(updates, ", "))
  exec_sql(sql, params)
  bump_domain_map_version()
  ngx.say(cjson.encode({ success = true, domain = body.domain }))
end

local function delete_domain()
  local body = read_body_json()
  local domain = body.domain or (ngx.var.delete_domain or "")
  if not domain or domain == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "domain is required" }))
    return
  end
  local check = exec_sql("SELECT domain FROM domains WHERE domain = ?", { domain })
  if not check or check == "" or check == "[]" then
    ngx.status = 404
    ngx.say(cjson.encode({ error = "Domain not found" }))
    return
  end
  exec_sql("DELETE FROM domains WHERE domain = ?", { domain })
  bump_domain_map_version()
  ngx.say(cjson.encode({ success = true, domain = domain }))
end

local action = ngx.var.domain_action
set_json()
if not auth_required() then
  ngx.status = 401
  ngx.say(cjson.encode({ error = "Unauthorized" }))
  return
end
if action == "list_domains" then
  return list_domains()

elseif action == "list_subdomains" then
  local parent = ngx.var.parent_domain or ""
  return list_subdomains(parent)

elseif action == "get_domain_target" then
  local domain = ngx.var.requested_domain or ""
  return get_domain_target(domain)

elseif action == "add_domain" then
  return add_domain()

elseif action == "update_domain" then
  return update_domain()

elseif action == "delete_domain" then
  return delete_domain()

else
  ngx.status = 404
  ngx.say(cjson.encode({ error = "Unknown domain action" }))
end
