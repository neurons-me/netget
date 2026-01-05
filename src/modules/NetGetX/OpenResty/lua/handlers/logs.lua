local cjson = require "cjson.safe"
local ck = require "resty.cookie"

local function set_json()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function verify_cookie()
  local cookie = ck:new()
  local token, err = cookie:get("token")
  if not token then return false end
  return true
end

local function read_file_tail(path)
  local fh, err = io.open(path, "r")
  if not fh then return nil end
  local data = fh:read("*a")
  fh:close()
  return data or ""
end

local function parse_qs()
  local args = ngx.req.get_uri_args()
  local t = {}
  for k,v in pairs(args) do
    t[k] = type(v) == "table" and v[1] or v
  end
  return t
end

local function handle_logs()
  set_json()
  if not verify_cookie() then
    ngx.status = 401
    ngx.say(cjson.encode({ error = "Unauthorized" }))
    return
  end
  local args = parse_qs()
  local logType = args["type"] or "access"
  local limit = tonumber(args["limit"]) or 100
  local offset = tonumber(args["offset"]) or 0

  local NGINX_LOGS_PATH = os.getenv("NGINX_LOGS_PATH") or "/usr/local/openresty/nginx/logs"
  local SERVER_LOG_PATH = os.getenv("SERVER_LOG_PATH") or "./server.log"

  local target
  if logType == "access" then
    target = NGINX_LOGS_PATH .. "/access.log"
  elseif logType == "error" then
    target = NGINX_LOGS_PATH .. "/error.log"
  elseif logType == "server" then
    target = SERVER_LOG_PATH
  else
    ngx.status = 400
    ngx.say(cjson.encode({ error = "Invalid log type. Use 'access', 'error', or 'server'" }))
    return
  end

  local content = read_file_tail(target) or ""
  local lines = {}
  for line in content:gmatch("[^\n]+") do
    table.insert(lines, line)
  end

  local total = #lines
  local result = {}
  -- reverse order, slice offset..offset+limit
  for i = total, 1, -1 do
    local idx = total - i
    if idx >= offset and #result < limit then
      table.insert(result, lines[i])
    end
  end

  ngx.say(cjson.encode({
    logs = result,
    total = total,
    offset = offset,
    limit = limit,
    logType = logType
  }))
end

return handle_logs()
