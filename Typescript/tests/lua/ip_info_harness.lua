-- Runs handlers/misc.lua's ip_info action against a stubbed ngx: arg[1] = remote_addr, arg[2] = misc.lua path.
-- NETGET_DATA_DIR (env) says where xConfig.json is. Prints the JSON the handler would send.
local remote_addr, misc = arg[1], arg[2]
ngx = {
  var = { misc_action = "ip_info", remote_addr = remote_addr, server_addr = "127.0.0.1", NETGET_DATA_DIR = "" },
  header = {},
  status = 200,
  say = function(s) print(s) end,
  exit = function() end,
}
dofile(misc)
