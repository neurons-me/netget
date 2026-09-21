-- lua/middleware/jwt_cookie.lua
-- Middleware: verify JWT stored in cookie 'token'
-- Requires: lua-resty-jwt, lua-resty-cookie
-- A process on this machine (the real peer address) needs no token; anyone else needs a verified one, over HTTPS only (lib/operator_access.lua).
local cjson = require("cjson")

local function jwt_cookie_middleware()
  local operator = require("lib.operator_access")

  -- A process on this machine is the operator: no token needed (local development, the CLI).
  if operator.is_loopback() then
    ngx.ctx.user_claims = { username = "local_dev", ["local"] = true }
    return
  end

  -- Anyone else needs a verified token, over HTTPS only, signed with a secret fit to sign with.
  if (ngx.var.scheme or "http") ~= "https" then
    ngx.status = ngx.HTTP_FORBIDDEN
    ngx.say(cjson.encode({ error = 'HTTPS required' }))
    return ngx.exit(ngx.HTTP_FORBIDDEN)
  end
  local payload = operator.jwt_payload()
  if not payload then
    ngx.status = ngx.HTTP_UNAUTHORIZED
    ngx.say(cjson.encode({ error = 'A valid token is required' }))
    return ngx.exit(ngx.HTTP_UNAUTHORIZED)
  end

  -- Expose claims to downstream handlers
  ngx.ctx.user_claims = payload
end

return jwt_cookie_middleware
