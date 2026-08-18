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

-- Strict allow-lists, not a full hostname/email grammar — the only property
-- that matters here is that neither value can carry a shell metacharacter,
-- since both get interpolated into a shell command below.
local function is_safe_domain(d)
  if type(d) ~= "string" or d == "" or #d > 253 then return false end
  if not d:match("^[%w.%-]+$") then return false end
  if d:match("^[%.%-]") or d:match("[%.%-]$") or d:match("%.%.") then return false end
  return d:match("%.") ~= nil
end

local function is_safe_email(e)
  if type(e) ~= "string" or e == "" or #e > 254 then return false end
  return e:match("^[%w.%+%-_]+@[%w.%-]+%.[%w]+$") ~= nil
end

-- io.popen inherits the OpenResty worker's own PATH, which under launchd is
-- a minimal system PATH -- it does NOT include nvm/homebrew bin dirs, so
-- `which netget` (and any `npx netget` fallback) silently fails here even
-- though both resolve fine from an interactive shell. nginx also clears
-- inherited env vars entirely except what's declared via `env` directives
-- (HOME is not declared), so os.getenv("HOME") is nil here too even though
-- it's set for the process that generated this config.
--
-- $NETGET_CLI_BIN is baked into the config at generation time by
-- setNginxConfigRoutes.ts (resolveNetgetCliBinPath, run from the real
-- netget CLI process which does have a normal PATH) -- check that first,
-- falling back to known absolute locations and an env override for
-- anything generation-time resolution couldn't find.
local function resolve_netget_bin()
  local candidates = {
    ngx.var.NETGET_CLI_BIN,
    os.getenv("NETGET_CLI_BIN"),
    "/usr/local/bin/netget",
    "/opt/homebrew/bin/netget",
  }
  for _, candidate in ipairs(candidates) do
    if candidate and candidate ~= "" then
      local f = io.open(candidate, "r")
      if f then f:close(); return candidate end
    end
  end

  -- nvm-managed installs: ~/.nvm/versions/node/<version>/bin/netget. The
  -- version directory name varies, so glob for it with `ls` (not `which`,
  -- so this still doesn't depend on PATH).
  local home = os.getenv("HOME")
  if home then
    local f = io.popen("ls -1 " .. home .. "/.nvm/versions/node/*/bin/netget 2>/dev/null | head -n1")
    if f then
      local out = f:read("*a")
      f:close()
      out = out:gsub("%s+$", "")
      if out ~= "" then return out end
    end
  end

  return nil
end

-- `netget` itself is a `#!/usr/bin/env node` script: even with an absolute
-- path to it, the shell still resolves `node` via PATH to honor the shebang
-- before any JS runs. The worker's PATH doesn't have node on it, so without
-- this, invocation fails at the OS level with "env: node: No such file or
-- directory".
local function bin_dir(path)
  return path:match("^(.*)/[^/]+$") or "."
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
  local decoded = cjson.decode(out) or {}
  -- cjson.decode("[]") returns the special cjson.empty_array sentinel, a
  -- userdata value, NOT a plain table — #decoded would throw on it. Only
  -- take the length of an actual Lua table; anything else (empty_array or
  -- any other non-table decode result) means zero rows.
  local count = (type(decoded) == "table") and #decoded or 0
  local domains = (count == 0) and cjson.empty_array or decoded
  ngx.say(cjson.encode({ success = true, domains = domains, count = count }))
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
  -- Only domain is required. target is optional: public domains are routed
  -- through surface_proxy.lua's mesh reduction regardless of what target
  -- says (see setNginxConfigRoutes.ts publicDomainBlocks) — target is only
  -- meaningful for non-mesh domain types that bypass the mesh entirely.
  if not body.domain or body.domain == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "domain is required" }))
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
    body.target or '',
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

-- Provision (or renew) a Let's Encrypt cert for an already-registered domain
-- by shelling out to `netget provision-cert` (netget.cli.ts), which wraps
-- certbotProvision.ts directly — no logic duplicated here in Lua.
--
-- This is a synchronous, blocking io.popen call: certbot's real network
-- round-trip to Let's Encrypt can take several seconds, and this nginx
-- worker is blocked for the duration. Consistent with how exec_sql already
-- blocks elsewhere in this file, but callers should expect a slow response
-- (tens of seconds is normal), not a fast one.
local function provision_cert()
  local body = read_body_json()
  if not is_safe_domain(body.domain) then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "domain is required and must be a valid hostname" }))
    return
  end
  if not is_safe_email(body.email) then
    ngx.status = 400
    ngx.say(cjson.encode({ error = "email is required and must be a valid address" }))
    return
  end

  local check = exec_sql("SELECT domain FROM domains WHERE domain = ?", { body.domain })
  if not check or check == "" or check == "[]" then
    ngx.status = 404
    ngx.say(cjson.encode({ error = "Domain not registered — call /add-domain first" }))
    return
  end

  local netgetBin = resolve_netget_bin()
  if not netgetBin then
    ngx.status = 500
    ngx.say(cjson.encode({ ok = false, error = "netget CLI not found in any known install location (set NETGET_CLI_BIN to its absolute path)" }))
    return
  end
  local cmd = string.format('PATH="%s:$PATH" %s provision-cert \'%s\' --email \'%s\' 2>&1', bin_dir(netgetBin), netgetBin, body.domain, body.email)
  local f = io.popen(cmd)
  if not f then
    ngx.status = 500
    ngx.say(cjson.encode({ ok = false, error = "failed to start provisioning process" }))
    return
  end
  local out = f:read("*a")
  f:close()

  -- `netget provision-cert` prints exactly one JSON line to stdout — take
  -- the last non-empty line in case certbot itself logged anything above it.
  local lastLine = nil
  for line in out:gmatch("[^\n]+") do
    lastLine = line
  end
  local ok, parsed = pcall(function() return cjson.decode(lastLine or "") end)
  if ok and parsed then
    if not parsed.ok then ngx.status = 502 end
    ngx.say(cjson.encode(parsed))
  else
    ngx.status = 502
    ngx.say(cjson.encode({ ok = false, error = "provisioning failed", raw = out }))
  end
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

elseif action == "provision_cert" then
  return provision_cert()

else
  ngx.status = 404
  ngx.say(cjson.encode({ error = "Unknown domain action" }))
end
