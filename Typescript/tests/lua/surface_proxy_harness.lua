-- Runs handlers/surface_proxy.lua against a stubbed ngx and prints ONE json line with what it decided.
--   resty surface_proxy_harness.lua <handler.lua> <data-dir> <host> [accept]
-- <data-dir>/runtime/apps.json and (optionally) domain-map.json are the inputs; NETGET_DATA_DIR is set from <data-dir>.
local cjson = require "cjson.safe"
local handler, dir, host, accept = arg[1], arg[2], arg[3], arg[4] or "application/json"
local out = { status = 200, vars = {}, body = {} }
ngx = {
  var = setmetatable({ host = host, http_accept = accept, NETGET_DATA_DIR = dir, surface_proxy_target = "", surface_proxy_identity = "" }, {
    __newindex = function(t, k, v) rawset(t, k, v) end,
  }),
  header = {}, HTTP_SERVICE_UNAVAILABLE = 503, WARN = "WARN", ERR = "ERR",
  log = function(level, ...) out.log = (out.log or "") .. table.concat({ ... }, "") .. "\n" end,
  now = function() return tonumber(os.getenv("HARNESS_NOW") or "2000") end,
  say = function(...) for _, v in ipairs({ ... }) do table.insert(out.body, tostring(v)) end end,
  print = function(...) end,
  exit = function(code) out.exit = code; error({ __exit = true }) end,
}
setmetatable(ngx, { __index = function(_, k) return nil end })
local ok, err = pcall(dofile, handler)
if not ok and not (type(err) == "table" and err.__exit) then out.error = tostring(err) end
out.target = ngx.var.surface_proxy_target
out.identity = ngx.var.surface_proxy_identity
out.status = ngx.status or out.status
out.reason = table.concat(out.body):match('"error"%s*:%s*"([^"]*)"') or table.concat(out.body):match("conflict[^<]*") or nil
out.body = nil
print(cjson.encode(out))
