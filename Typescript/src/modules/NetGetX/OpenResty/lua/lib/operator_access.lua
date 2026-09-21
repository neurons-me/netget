-- operator_access.lua -- who may run the gateway's control actions (restart/stop OpenResty, start/stop the
-- dev server, read the server logs), decided by what nginx actually knows about the connection.
--
--   * A Host header proves nothing: any client can send "Host: localhost". Only the real peer address
--     (ngx.var.remote_addr) says a process runs on this machine.
--   * "Plain HTTP means local development" is not a credential: the gateway listens on port 80 for the
--     whole internet.
--   * There is no token to present. The gateway authenticates with .me signatures and admin sessions (the
--     monad's routes); these Lua handlers are for the machine's own operator, and nothing else issues a
--     cookie or a JWT that they could check. An older version verified a JWT cookie -- with a built-in
--     default secret -- and one handler accepted any cookie named "token"; both are gone.
--
-- Note: behind another reverse proxy on the same machine (a tunnel that connects from 127.0.0.1) every
-- client looks like loopback; such an installation must not rely on the address alone.

local M = {}

--- True when the connection really comes from a process on this machine.
function M.is_loopback()
  local ip = ngx.var.remote_addr or ""
  return ip == "127.0.0.1" or ip == "::1" or ip == "unix:"
end

--- May this connection run a control action? Only a process on this machine.
function M.authorized_operator()
  return M.is_loopback()
end

return M
