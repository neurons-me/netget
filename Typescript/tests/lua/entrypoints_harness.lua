-- Runs handlers/surface_resolution.lua's `entrypoints` action against a stubbed ngx: arg[1] = remote_addr,
-- arg[2] = handler path, arg[3] = MAIN_SERVER_NAME ("" for none). Prints the JSON it would send.
local remote_addr, handler, main = arg[1], arg[2], arg[3] or ""
_G.MAIN_SERVER_NAME = main ~= "" and main or nil
ngx = {
  var = { surface_resolution_action = "entrypoints", remote_addr = remote_addr, NETGET_DATA_DIR = "" },
  header = {}, status = 200, say = function(s) print(s) end, exit = function() end,
}
dofile(handler)
