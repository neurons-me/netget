-- dev_server.lua
-- Local GUI package dev server control: status (read-only), start, stop.
-- Shells out to `netget dev-server-status|dev-server-start|dev-server-stop`
-- (netget.cli.ts), which wraps devServer.ts directly -- no logic duplicated
-- here. Mirrors openresty.lua exactly (same auth model, same
-- resolve_netget_bin/run_netget PATH workaround for launchd's stripped env).
--
-- Trust: same model as openresty.lua -- HTTP/loopback caller is the
-- operator; HTTPS requires a verified JWT cookie.

local cjson = require "cjson.safe"
local jwt = require "resty.jwt"
local ck = require "resty.cookie"

local JWT_SECRET = os.getenv("JWT_SECRET") or "dev_secret"

local function auth_required()
  local scheme = ngx.var.scheme or "http"
  if scheme ~= "https" then
    return true
  end
  local cookie = ck:new()
  local token = cookie:get("token")
  if not token then return false end
  local obj = jwt:verify(JWT_SECRET, token)
  return obj and obj.verified
end

-- See openresty.lua for why this can't just rely on PATH under launchd.
local function resolve_netget_bin()
  local candidates = {
    ngx.var.NETGET_CLI_BIN,
    os.getenv("NETGET_CLI_BIN"),
    "/usr/local/bin/netget",
    "/opt/homebrew/bin/netget",
  }
  for _, candidate in ipairs(candidates) do
    if candidate and candidate ~= "" then
      local f = io.open(candidate, "r")
      if f then f:close(); return candidate end
    end
  end

  local home = os.getenv("HOME")
  if home then
    local f = io.popen("ls -1 " .. home .. "/.nvm/versions/node/*/bin/netget 2>/dev/null | head -n1")
    if f then
      local out = f:read("*a")
      f:close()
      out = out:gsub("%s+$", "")
      if out ~= "" then return out end
    end
  end

  return nil
end

local function bin_dir(path)
  return path:match("^(.*)/[^/]+$") or "."
end

local function run_netget(args)
  local netgetBin = resolve_netget_bin()
  if not netgetBin then
    return { ok = false, message = "netget CLI not found in any known install location (set NETGET_CLI_BIN to its absolute path)" }
  end
  local cmd = string.format('PATH="%s:$PATH" %s %s 2>&1', bin_dir(netgetBin), netgetBin, args)
  local f = io.popen(cmd)
  if not f then
    return { ok = false, message = "failed to start netget process" }
  end
  local out = f:read("*a")
  f:close()

  local lastLine = nil
  for line in out:gmatch("[^\n]+") do
    lastLine = line
  end
  local ok, parsed = pcall(function() return cjson.decode(lastLine or "") end)
  if ok and parsed then return parsed end
  return { ok = false, message = "netget command produced no parseable output", raw = out }
end

ngx.header["Content-Type"] = "application/json; charset=utf-8"

if not auth_required() then
  ngx.status = 401
  ngx.say(cjson.encode({ ok = false, error = "Unauthorized" }))
  return
end

local action = ngx.var.dev_server_action
local result

if action == "status" then
  result = run_netget("dev-server-status")
elseif action == "start" then
  result = run_netget("dev-server-start")
elseif action == "stop" then
  result = run_netget("dev-server-stop")
else
  ngx.status = 404
  ngx.say(cjson.encode({ ok = false, error = "Unknown dev-server action" }))
  return
end

if not result.ok then ngx.status = 502 end
ngx.say(cjson.encode(result))
