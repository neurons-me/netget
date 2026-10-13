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

--- True when the request's verified .me identity (set by middleware/me_sig.lua,
--- which must already have run in the SAME location's access phase -- this
--- function never verifies a proof itself, it only reads what me_sig.lua
--- already put on ngx.ctx) may perform `cap`, a specific gateway control
--- capability string (e.g. "gateway:control:openresty-restart").
---
--- Deliberately NOT owner-bypassed. An earlier version of this function gave
--- the gateway owner a free pass ("ownership is the root of authority"), on
--- the assumption that mirrored the daemon's own capability model -- it did
--- not. The daemon's REAL check, localNetget.js's /domains/metadata handler
--- (`if (!scopes.includes('gateway:write:domain-metadata')) return 403`),
--- has no owner exception at all: scopes come only from the identity's own
--- claims.grants entry (what me_sig.lua forwards as X-Netget-Scopes), and
--- that is the ENTIRE check -- not even the owner is exempt there. This
--- function now matches that exactly: a capability is always an explicit
--- grant, regardless of claims.owner/claims.admins. Loopback
--- (operator_access.is_loopback/authorized_operator) is a SEPARATE,
--- additional check this function does not replace -- a request still needs
--- to be from this machine AND carry this exact capability.
---
--- This reads ngx.ctx.me_scopes, not a second, independently-loaded copy of
--- gateway-claims.json -- it is the exact same value me_sig.lua's
--- verify_request() already computed for THIS request (its own
--- version-gated claims cache, keyed off gateway-claims.json +
--- gateway-claims.version under NETGET_DATA_DIR/runtime -- see that file's
--- "Claims loader" section), the same cache /domains/metadata's
--- X-Netget-Scopes header is built from. No separate authority source, no
--- separate freshness/revocation story: a grant revoked there is just as
--- immediately absent here, because both read the one cache through the one
--- loader.
function M.has_capability(cap)
  local scopes = ngx.ctx.me_scopes
  if type(scopes) ~= "table" then return false end
  for _, scope in ipairs(scopes) do
    if scope == cap then return true end
  end
  return false
end

return M
