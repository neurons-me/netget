-- lua/handlers/protected.lua
-- Example handler that reads user claims set by jwt_cookie middleware
local cjson = require("cjson")
ngx.header.content_type = 'application/json; charset=utf-8'
local claims = ngx.ctx.user_claims or {}
ngx.say(cjson.encode({ ok = true, user = claims }))
