-- lua/middleware/jwt_cookie.lua
-- Middleware: verify JWT stored in cookie 'token'
-- Requires: lua-resty-jwt, lua-resty-cookie
local jwt = require("resty.jwt")
local cookie = require("resty.cookie")
local cjson = require("cjson")

local JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET or JWT_SECRET == '' then
  ngx.log(ngx.ERR, 'JWT_SECRET env variable missing')
  return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
end

local ck = cookie:new()
local token, err = ck:get("token")
if not token then
  ngx.status = ngx.HTTP_UNAUTHORIZED
  ngx.say(cjson.encode({ error = 'No token provided' }))
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

local jwt_obj = jwt:verify(JWT_SECRET, token)
if not jwt_obj.verified then
  ngx.status = ngx.HTTP_BAD_REQUEST
  ngx.say(cjson.encode({ error = 'Invalid token', reason = jwt_obj.reason }))
  return ngx.exit(ngx.HTTP_BAD_REQUEST)
end

-- Expose claims to downstream handlers
ngx.ctx.user_claims = jwt_obj.payload
