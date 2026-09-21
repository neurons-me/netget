-- operator_access.lua -- who may run the gateway's control actions (restart/stop OpenResty, start/stop
-- the dev server, read protected data), decided by what nginx actually knows about the connection.
--
--   * A Host header proves nothing: any client can send "Host: localhost". Only the real peer address
--     (ngx.var.remote_addr) says a process runs on this machine.
--   * "Plain HTTP means local development" is not a credential: the gateway listens on port 80 for the
--     whole internet. Plain HTTP is trusted only when the peer really is this machine.
--   * A JWT is a credential only if it is signed with a secret nobody can guess: taken from the
--     environment, long enough, and never a built-in default. Without one, no token is accepted.
--
-- Note: behind another reverse proxy on the same machine (a tunnel that connects from 127.0.0.1) every
-- client looks like loopback; such an installation must not rely on the address alone.

local M = {}

local WELL_KNOWN = { dev_secret = true, secret = true, changeme = true, password = true, jwt_secret = true }
local MIN_SECRET_LENGTH = 32

--- True when the connection really comes from a process on this machine.
function M.is_loopback()
  local ip = ngx.var.remote_addr or ""
  return ip == "127.0.0.1" or ip == "::1" or ip == "unix:"
end

--- The JWT signing secret, or nil when none is configured that is fit to sign with.
function M.jwt_secret()
  local secret = os.getenv("JWT_SECRET")
  if not secret or #secret < MIN_SECRET_LENGTH or WELL_KNOWN[secret:lower()] then return nil end
  return secret
end

--- The verified payload of the cookie 'token', or nil.
function M.jwt_payload()
  local secret = M.jwt_secret()
  if not secret then return nil end
  local ok_jwt, jwt = pcall(require, "resty.jwt")
  local ok_ck, ck = pcall(require, "resty.cookie")
  if not ok_jwt or not ok_ck then return nil end
  local token = ck:new():get("token")
  if not token then return nil end
  local obj = jwt:verify(secret, token)
  if obj and obj.verified then return obj.payload or {} end
  return nil
end

--- May this connection run a control action? A process on this machine, or (over HTTPS only) a verified JWT.
function M.authorized_operator()
  if M.is_loopback() then return true end
  if (ngx.var.scheme or "http") ~= "https" then return false end
  return M.jwt_payload() ~= nil
end

return M
