import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getNetgetAppConfContent } from '../src/modules/NetGetX/OpenResty/setNginxConfigRoutes.ts';

const conf = getNetgetAppConfContent();

assert.match(conf, /location ~ \^\/monads\/\(\[\^\/\]\+\)\(\/\.\*\)\?\$/);
assert.match(conf, /set \$monad_proxy_name \$1;/);
assert.match(conf, /rewrite_by_lua_file lua\/handlers\/monad_proxy\.lua;/);
assert.match(conf, /proxy_pass \$monad_proxy_target;/);
assert.match(conf, /proxy_set_header X-NetGet-App-Kind monad;/);

const luaPath = path.resolve('src/modules/NetGetX/OpenResty/lua/handlers/monad_proxy.lua');
const lua = fs.readFileSync(luaPath, 'utf8');

assert.match(lua, /local function exposure_allows_request/);
assert.match(lua, /visibility == "loopback"/);
assert.match(lua, /Monad proxy only accepts loopback app targets/);
assert.match(lua, /is_fresh\(app\)/);

console.log('monad-proxy-config ok');
