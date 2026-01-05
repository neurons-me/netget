local cjson = require "cjson.safe"
local jwt = require "resty.jwt"
local ck = require "resty.cookie"

local JWT_SECRET = os.getenv("JWT_SECRET") or "dev_secret"
local USE_HTTPS = (os.getenv("USE_HTTPS") or "false"):lower() == "true"

local function read_body_json()
  ngx.req.read_body()
  local data = ngx.req.get_body_data()
  if not data then return nil end
  local obj, err = cjson.decode(data)
  if not obj then return nil end
  return obj
end

local function set_json_headers()
  ngx.header["Content-Type"] = "application/json; charset=utf-8"
end

local function cookie_opts()
  local opts = {
    path = "/",
    httponly = true,
    samesite = USE_HTTPS and "None" or "Lax",
  }
  if USE_HTTPS then opts.secure = true end
  return opts
end

local function set_cookie(name, value, max_age)
  local cookie = ck:new()
  local opts = cookie_opts()
  opts.key = name
  opts.value = value
  if max_age then opts.max_age = max_age end
  local ok, err = cookie:set(opts)
  return ok
end

local function clear_cookie(name)
  local cookie = ck:new()
  local opts = cookie_opts()
  opts.key = name
  opts.value = ""
  opts.expires = "Thu, 01 Jan 1970 00:00:00 GMT"
  cookie:set(opts)
end

local function check_auth()
  set_json_headers()
  local cookie = ck:new()
  local token, err = cookie:get("token")
  if not token then
    ngx.say(cjson.encode({ authenticated = false }))
    return
  end
  local jwt_obj = jwt:verify(JWT_SECRET, token)
  if jwt_obj and jwt_obj.verified then
    ngx.say(cjson.encode({ authenticated = true, user = jwt_obj.payload }))
  else
    ngx.say(cjson.encode({ authenticated = false }))
  end
end

local function login()
  set_json_headers()
  local body = read_body_json() or {}
  local username = (body.username or ""):gsub("^%s+|%s+$","")
  local password = (body.password or "")

  if username == "" or password == "" then
    ngx.status = 400
    ngx.say(cjson.encode({ success = false, message = "Username and password are required" }))
    return
  end

  local valid_users = {
    { username = "admin", password = "orwell1984", role = "admin" },
    { username = "bren",  password = "orwell1984", role = "user" },
  }
  local role
  for _, u in ipairs(valid_users) do
    if u.username == username and u.password == password then
      role = u.role
      break
    end
  end
  if not role then
    ngx.status = 401
    ngx.say(cjson.encode({ success = false, message = "Invalid credentials" }))
    return
  end

  local payload = { username = username, role = role, iat = ngx.time(), exp = ngx.time() + 24*60*60 }
  local token = jwt:sign(JWT_SECRET, { header = { typ = "JWT", alg = "HS256" }, payload = payload })
  set_cookie("token", token, 24*60*60)
  ngx.say(cjson.encode({ success = true, user = { username = username, role = role } }))
end

local function logout()
  set_json_headers()
  clear_cookie("token")
  ngx.say(cjson.encode({ success = true, message = "Logged out successfully" }))
end

local action = ngx.var.auth_action
if action == "check_auth" then
  return check_auth()
elseif action == "login" then
  return login()
elseif action == "logout" then
  return logout()
else
  ngx.status = 404
  ngx.say("{}")
end
