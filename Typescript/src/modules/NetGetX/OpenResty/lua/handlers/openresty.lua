-- openresty.lua
-- OpenResty/NetGet gateway control: status (read-only), restart, stop.
-- Shells out to `netget status|reload --json|stop` (netget.cli.ts), which
-- wraps openRestyService.ts directly -- no logic duplicated here.
--
-- Trust: same model as domains.lua -- HTTP/loopback caller is the operator;
-- HTTPS requires a verified JWT cookie.
--
-- status never touches sudo (port checks + launchctl/systemctl queries are
-- read-only) -- safe to poll. restart/stop shell out through sudo
-- (openRestyService.ts runSudoShell) and will fail with a clear JSON error,
-- not a hang, if this OpenResty worker has no passwordless sudo rule for the
-- OpenResty binary/launchctl/systemctl -- that constraint is not something
-- this handler can silently work around.
--
-- stop is a graceful `<bin> -s quit`: nginx finishes in-flight requests
-- (including this one) before the master process actually exits, so the
-- JSON response below does reach the caller even though it just told its
-- own server to shut down.

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

-- io.popen inherits the OpenResty worker's own PATH, which under launchd is
-- a minimal system PATH -- it does NOT include nvm/homebrew bin dirs, so
-- `which netget` (and any `npx netget` fallback) silently fails here even
-- though both resolve fine from an interactive shell. nginx also clears
-- inherited env vars entirely except what's declared via `env` directives
-- (HOME is not declared), so os.getenv("HOME") is nil here too even though
-- it's set for the process that generated this config.
--
-- $NETGET_CLI_BIN is baked into the config at generation time by
-- setNginxConfigRoutes.ts (resolveNetgetCliBinPath, run from the real
-- netget CLI process which does have a normal PATH) -- check that first,
-- falling back to known absolute locations and an env override for
-- anything generation-time resolution couldn't find.
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

  -- nvm-managed installs: ~/.nvm/versions/node/<version>/bin/netget. The
  -- version directory name varies, so glob for it with `ls` (not `which`,
  -- so this still doesn't depend on PATH).
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

-- `netget` itself is a `#!/usr/bin/env node` script: even with an absolute
-- path to it, the shell still resolves `node` via PATH to honor the shebang
-- before any JS runs. The worker's PATH doesn't have node on it, so without
-- this, invocation fails at the OS level with "env: node: No such file or
-- directory" -- before netget's own code (which now uses process.execPath
-- internally, see bin/netget) ever gets a chance to run.
local function bin_dir(path)
  return path:match("^(.*)/[^/]+$") or "."
end

-- Runs `netget <args>`, parses the last non-empty stdout line as JSON (each
-- of status/reload --json/stop prints exactly one JSON line).
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

local action = ngx.var.openresty_action
local result

if action == "status" then
  result = run_netget("status")
elseif action == "restart" then
  result = run_netget("reload --json")
elseif action == "stop" then
  result = run_netget("stop")
else
  ngx.status = 404
  ngx.say(cjson.encode({ ok = false, error = "Unknown openresty action" }))
  return
end

if not result.ok then ngx.status = 502 end
ngx.say(cjson.encode(result))
