-- lua/handlers/deploy.lua
-- Minimal migration of deploy endpoints with token auth and JSON flows.
-- Note: File upload (multipart) requires lua-resty-upload. A basic handler is provided.
local cjson = require('cjson')
ngx.header.content_type = 'application/json; charset=utf-8'

local function json(body_tbl, status)
	if status then ngx.status = status end
	ngx.say(cjson.encode(body_tbl))
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

local function bearer_auth()
	local h = ngx.req.get_headers()
	local auth = h["authorization"] or h["Authorization"]
	if not auth or auth:sub(1,7) ~= 'Bearer ' then
		return nil, 'Missing or invalid authorization header'
	end
	return auth:sub(8)
end

local function check_api_key()
	local apiKey, err = bearer_auth()
	if not apiKey then return nil, err end
	local allowed = os.getenv('AUTHORIZED_KEYS') or ''
	local ok = false
	for key in string.gmatch(allowed, '([^,]+)') do
		if key and apiKey == (key:gsub('^%s*(.-)%s*$', '%1')) then ok = true; break end
	end
	if not ok then return nil, 'Invalid API key' end
	return true
end

local uri = ngx.var.uri or ''
local method = ngx.req.get_method()

-- Root POST /deploy (JSON)
if uri == '/deploy' and method == 'POST' then
	local body = read_body_json() or {}
	if not body.token or not body.routes or not body.server then
		return json({ error = 'Faltan campos obligatorios' }, 400)
	end
	local deploy_token = os.getenv('DEPLOY_TOKEN')
	if not deploy_token or body.token ~= deploy_token then
		return json({ error = 'Token inválido' }, 403)
	end
	ngx.log(ngx.INFO, 'Deploy received: ', cjson.encode({ server = body.server, routes = #body.routes }))
	return json({ success = true, message = 'Despliegue ejecutado correctamente', details = { deployedTo = body.server, routes = #body.routes } }, 200)
end

-- Health (GET /deploy/health) with bearer auth
if uri == '/deploy/health' and method == 'GET' then
	local ok, err = check_api_key()
	if not ok then return json({ error = err }, 403) end
	return json({ ok = true, status = 'healthy', time = os.date('!%Y-%m-%dT%H:%M:%SZ') })
end

-- Sync domains
if uri == '/deploy/sync/domains' then
	local ok, err = check_api_key()
	if not ok then return json({ error = err }, 403) end
	if method == 'GET' then
		-- No DB here; return empty list placeholder
		return json({ domains = {}, count = 0, timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ') })
	elseif method == 'POST' then
		local body = read_body_json() or {}
		if type(body.domains) ~= 'table' then
			return json({ error = 'Invalid request: domains array is required' }, 400)
		end
		-- Stub "persist": accept and echo back
		return json({ message = 'Domain configurations synced successfully', database = { updated = #body.domains }, timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ') })
	else
		ngx.status = 405; return ngx.say(cjson.encode({ error = 'Method Not Allowed' }))
	end
end

-- Upload (POST /deploy/sync/deploy) using lua-resty-upload
if uri == '/deploy/sync/deploy' and method == 'POST' then
	local ok, err = check_api_key()
	if not ok then return json({ error = err }, 403) end
	local upload = require('resty.upload')
	local chunk_size = 4096
	local form, err = upload:new(chunk_size)
	if not form then return json({ error = 'upload init failed: ' .. (err or '') }, 500) end
	form:set_timeout(600000) -- 10min

	local tmpdir = '/tmp/uploads'
	os.execute(string.format('mkdir -p %q', tmpdir))

	local current_file
	local file_path
	local domain
	while true do
		local typ, res, err = form:read()
		if not typ then return json({ error = err or 'read error' }, 500) end
		if typ == 'header' then
			local header_name = res[1]
			local header_val = res[2]
			if header_name == 'Content-Disposition' then
				local name = header_val:match('name="([^"]+)"')
				local filename = header_val:match('filename="([^"]*)"')
				if filename and filename ~= '' then
					file_path = string.format('%s/%d_%s', tmpdir, ngx.worker.pid(), filename)
					current_file = io.open(file_path, 'w+')
				else
					-- next part could be 'domain' field; capture in body reading
				end
			end
		elseif typ == 'body' then
			if current_file then current_file:write(res) end
		elseif typ == 'part_end' then
			if current_file then current_file:close(); current_file = nil end
		elseif typ == 'eof' then
			break
		end
	end

	-- In parallel, try reading JSON body (if sent as separate request) to capture domain
	local args = ngx.req.get_post_args() or {}
	domain = args.domain or domain or 'unknown'

	if not file_path then
		return json({ error = 'Project file is required' }, 400)
	end

	-- Stub deployment
	return json({ message = 'Project deployed successfully for domain: ' .. domain, deployment = { file = file_path }, timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ') })
end

-- Status (GET /deploy/sync/status/:domain)
do
	local m = ngx.re.match(uri, [[^/deploy/sync/status/(.+)$]], 'jo')
	if m and method == 'GET' then
		local ok, err = check_api_key()
		if not ok then return json({ error = err }, 403) end
		local domain = ngx.unescape_uri(m[1])
		return json({ domain = domain, config = {}, projectDeployed = false, nginxConfigured = false, projectPath = '/var/www/' .. domain .. '/current', timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ') })
	end
end

ngx.status = 404
ngx.say(cjson.encode({ error = 'Not Found' }))
