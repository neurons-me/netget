import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// This test verifies that buildNginxConfigContent() wires up the 4 "gateway
// status" states (NOT_CONFIGURED, ACME_PENDING, DOMAIN_NOT_FOUND,
// SERVICE_UNAVAILABLE) into the generated nginx.conf:
//   - GatewayStatus.html is loaded at init_worker_by_lua_block and a
//     render_gateway_status() helper is defined
//   - the default_server location handles state 1 (NOT_CONFIGURED)
//   - the location / content_by_lua_block handles states 2 and 3
//   - @server has an error_page 502/503/504 directive for state 4
//
// The Lua control-flow itself (which branch fires for a given request) is
// not unit-testable here — this only checks that the generated config text
// contains the expected directives/markers.

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netget-data-'));
fs.mkdirSync(path.join(tmpDataDir, 'runtime'), { recursive: true });

process.env.NETGET_DATA_DIR = tmpDataDir;

const { buildNginxConfigContent } = await import('../src/modules/NetGetX/OpenResty/setNginxConfigFile.ts');

const conf = buildNginxConfigContent();

// GatewayStatus.html template is loaded once at init and a render helper is defined.
assert.match(conf, /GATEWAY_STATUS_TEMPLATE_PATH = ".*GatewayStatus\.html"/);
assert.match(conf, /_G\.GATEWAY_STATUS_TEMPLATE = read_file\(GATEWAY_STATUS_TEMPLATE_PATH\)/);
assert.match(conf, /function _G\.render_gateway_status\(state, host, target, show_dev_server_button\)/);

// Public IP is fetched/cached once per worker.
assert.match(conf, /_G\.GATEWAY_PUBLIC_IP/);

// MAIN_SERVER_NAME is threaded through from xConfig.json.
assert.match(conf, /MAIN_SERVER_NAME = "/);

// State 1 (NOT_CONFIGURED): default_server location special-cases empty mainServerName,
// excluding local.netget/localhost/127.0.0.1/*.local.
assert.match(conf, /_G\.MAIN_SERVER_NAME == ""/);
assert.match(conf, /host == "local\.netget"/);
assert.match(conf, /render_gateway_status\(1, host, ""\)/);

// State 3 (DOMAIN_NOT_FOUND): replaces the bare 404 for unregistered hosts.
assert.match(conf, /render_gateway_status\(3, host, ""\)/);

// State 2 (ACME_PENDING): HTTP requests to a registered-but-uncerted domain.
assert.match(conf, /ngx\.var\.server_port == "80" and route\.ssl and route\.ssl\.enabled == false/);
assert.match(conf, /render_gateway_status\(2, host, ""\)/);

// State 4 (SERVICE_UNAVAILABLE): error_page 502/503/504 on the @server proxy location.
assert.match(conf, /location @server \{[\s\S]*?error_page 502 503 504 = @gateway_service_unavailable;/);
assert.match(conf, /location @gateway_service_unavailable \{/);
assert.match(conf, /render_gateway_status\(4, host, ngx\.var\.gateway_target or ""\)/);

console.log('gateway-status ok');
