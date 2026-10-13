-- Runs handlers/surface_proxy.lua against a stubbed ngx and prints ONE json line with what it decided.
--   resty surface_proxy_harness.lua <handler.lua> <data-dir> <host> [accept]
-- <data-dir>/runtime/apps.json and (optionally) domain-map.json are the inputs; NETGET_DATA_DIR is set from <data-dir>.
-- HARNESS_URI (default "/") is the request path; a connection that answers it ends in ngx.exec("@door_connection")
-- with door_connection_target / door_connection_prefix set, reported as exec / connection_target / connection_prefix.
local cjson = require "cjson.safe"
local handler, dir, host, accept = arg[1], arg[2], arg[3], arg[4] or "application/json"
-- the handler's `lua/` root, so `require "lib.door_connections"` resolves the way it does under nginx
local lua_root = handler:match("^(.*)/handlers/[^/]+$")
if lua_root then package.path = lua_root .. "/?.lua;" .. package.path end
local out = { status = 200, vars = {}, body = {} }
ngx = {
  var = setmetatable({ host = host, uri = os.getenv("HARNESS_URI") or "/", remote_addr = os.getenv("HARNESS_REMOTE") or "127.0.0.1", http_accept = accept, NETGET_DATA_DIR = dir, surface_proxy_target = "", surface_proxy_identity = "", door_connection_target = "", door_connection_prefix = "" }, {
    __newindex = function(t, k, v) rawset(t, k, v) end,
  }),
  header = {}, HTTP_SERVICE_UNAVAILABLE = 503, WARN = "WARN", ERR = "ERR",
  log = function(level, ...) out.log = (out.log or "") .. table.concat({ ... }, "") .. "\n" end,
  now = function() return tonumber(os.getenv("HARNESS_NOW") or "2000") end,
  say = function(...) for _, v in ipairs({ ... }) do table.insert(out.body, tostring(v)) end end,
  print = function(...) end,
  exit = function(code) out.exit = code; error({ __exit = true }) end,
  exec = function(location) out.exec = location; error({ __exit = true }) end,
  req = { get_method = function() return os.getenv("HARNESS_METHOD") or "GET" end, discard_body = function() out.discarded = true end },
}
setmetatable(ngx, { __index = function(_, k) return nil end })
local ok, err = pcall(dofile, handler)
if not ok and not (type(err) == "table" and err.__exit) then out.error = tostring(err) end
out.target = ngx.var.surface_proxy_target
out.identity = ngx.var.surface_proxy_identity
out.connection_target = ngx.var.door_connection_target
out.connection_prefix = ngx.var.door_connection_prefix
out.status = ngx.status or out.status
out.reason = table.concat(out.body):match('"error"%s*:%s*"([^"]*)"') or table.concat(out.body):match("conflict[^<]*") or nil
out.body = nil
print(cjson.encode(out))
