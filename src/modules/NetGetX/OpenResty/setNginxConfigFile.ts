import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { handlePermission } from '../../utils/handlePermissions.ts';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';
import { detectOpenRestyLayout, type OpenRestyLayout } from './platformDetect.ts';

/**
 * Builds the nginx.conf content for the detected platform layout.
 * @memberof module:NetGetX.OpenResty
 */
export function buildNginxConfigContent(layout: OpenRestyLayout = detectOpenRestyLayout()): string {
    const xConfig = getNetgetDataDir();
    const sslCertPath = '/etc/ssl/certs/nginx-selfsigned.crt';
    const sslKeyPath  = '/etc/ssl/private/nginx-selfsigned.key';
    const sqliteDatabasePath = path.join(xConfig, 'domains.db');
    const domainMapPath      = path.join(xConfig, 'runtime', 'domain-map.json');
    const domainMapVersionPath = path.join(xConfig, 'runtime', 'domain-map.version');
    const appRegistryPath = path.join(xConfig, 'runtime', 'apps.json');

    const userLine = layout.userDirective ? `${layout.userDirective}\n` : '';
    const envLines = [
        'env JWT_SECRET;',
        'env CORS_ALLOWED_ORIGINS;',
        'env NODE_ENV;',
        'env USE_HTTPS;',
        'env NETGET_DATA_DIR;',
        'env NGINX_LOGS_PATH;',
        'env SERVER_LOG_PATH;',
        'env LOCAL_BACKEND_PORT;',
        'env AUTHORIZED_KEYS;',
        'env DEPLOY_TOKEN;'
    ].join('\n');

    return `${envLines}
${userLine}events {
    worker_connections 1024;
}

http {
    resolver    8.8.8.8 8.8.4.4 valid=300s;
    include     mime.types;
    include     ${layout.confDDir}/*.conf;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    default_type application/octet-stream;

    gzip on;
    gzip_disable "msie6";

    lua_shared_dict ssl_cache 10m;
    lua_package_path "${layout.luaPackagePath}";

    error_log ${layout.logDir}/error.log;
    access_log ${layout.logDir}/access.log;

    init_worker_by_lua_block {
        local cjson = require "cjson"
        local MAP_PATH     = "${domainMapPath}"
        local VERSION_PATH = "${domainMapVersionPath}"

        local function read_file(p)
            local f = io.open(p, "r")
            if not f then return nil end
            local d = f:read("*a")
            f:close()
            return d
        end

        local function load_map()
            local content = read_file(MAP_PATH)
            if not content then return end
            local ok, decoded = pcall(cjson.decode, content)
            if ok and decoded then
                _G.DOMAIN_MAP = decoded
            end
        end

        load_map()
        _G.DOMAIN_MAP_VERSION = read_file(VERSION_PATH) or ""

        local function check_reload(premature)
            if premature then return end
            local v = read_file(VERSION_PATH)
            if v and v ~= _G.DOMAIN_MAP_VERSION then
                load_map()
                _G.DOMAIN_MAP_VERSION = v
            end
        end

        local ok, err = ngx.timer.every(1, check_reload)
        if not ok then
            ngx.log(ngx.ERR, "domain-map timer failed to start: ", err)
        end
    }

    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        server_name _;

        root ${xConfig}/html;

        error_page 400 401 402 403 404 405 406 407 408 409 410 411 412 413 414 415 416 417 418 421 422 423 424 425 426 428 429 431 451 500 501 502 503 504 505 506 507 508 510 511 /NetgetErrorCodeHandler.html;
        location = /NetgetErrorCodeHandler.html {
            root ${xConfig}/html;
            internal;
        }
    }

    server {
        listen 443 ssl;
        listen [::]:443 ssl;
        server_name _;

        ssl_certificate     ${sslCertPath};
        ssl_certificate_key ${sslKeyPath};

        set $target_url "";
        set $root "";

        access_by_lua_block {
            local ssl_cache = ngx.shared.ssl_cache
            local host = ngx.var.host
            local wildcard_domain = "*." .. host:match("[^.]+%.(.+)")

            if host then
                ssl_cache:set("host", host)
                ssl_cache:set("wildcard_domain", wildcard_domain)
            end

            if not host then
                return ngx.exit(ngx.HTTP_BAD_REQUEST)
            end
        }

        ssl_certificate_by_lua_block {
            local ssl = require "ngx.ssl"

            local ok, err = ssl.clear_certs()
            if not ok then return ngx.exit(ngx.ERROR) end

            local host = ssl.server_name()
            if not host then return end

            host = string.lower(host):gsub(":%d+$", "")

            local map = _G.DOMAIN_MAP
            if not map then return end

            local route = map.domains[host]
            if not route or not route.ssl or not route.ssl.enabled then
                return
            end

            local cert_path = route.ssl.cert
            local key_path  = route.ssl.key
            if not cert_path or not key_path then return end

            local function read_file(p)
                local f = io.open(p, "r")
                if not f then return nil end
                local d = f:read("*a")
                f:close()
                return d
            end

            local pem_cert = read_file(cert_path)
            if not pem_cert then return end

            local der_cert = ssl.cert_pem_to_der(pem_cert)
            if not der_cert then return ngx.exit(ngx.ERROR) end

            local ok = ssl.set_der_cert(der_cert)
            if not ok then return ngx.exit(ngx.ERROR) end

            local pem_key = read_file(key_path)
            if not pem_key then return end

            local der_key = ssl.priv_key_pem_to_der(pem_key)
            if not der_key then return ngx.exit(ngx.ERROR) end

            local ok = ssl.set_der_priv_key(der_key)
            if not ok then return ngx.exit(ngx.ERROR) end
        }

        location /domain-target {
            default_type application/json;
            content_by_lua_block {
                local sqlite = require "lsqlite3"
                local cjson = require "cjson"

                local domain = ngx.var.arg_domain or ngx.var.host
                if domain then
                    domain = domain:match("([^:]+)")
                end

                if not domain then
                    ngx.status = ngx.HTTP_BAD_REQUEST
                    ngx.say(cjson.encode({ success = false, error = "Domain not specified" }))
                    return
                end

                local db, err = sqlite.open("${sqliteDatabasePath}")
                if not db then
                    ngx.status = ngx.HTTP_INTERNAL_SERVER_ERROR
                    ngx.say(cjson.encode({ success = false, error = "Failed to open SQLite database" }))
                    return
                end

                local stmt, err = db:prepare("SELECT target FROM domains WHERE domain = ?")
                if not stmt then
                    ngx.status = ngx.HTTP_INTERNAL_SERVER_ERROR
                    ngx.say(cjson.encode({ success = false, error = "Failed to prepare SQL statement" }))
                    db:close()
                    return
                end

                local res, err = stmt:bind_values(domain)
                if not res then
                    ngx.status = ngx.HTTP_INTERNAL_SERVER_ERROR
                    ngx.say(cjson.encode({ success = false, error = "Failed to bind values to SQL statement" }))
                    stmt:finalize()
                    db:close()
                    return
                end

                res = stmt:step()
                if res == sqlite.ROW then
                    local target = stmt:get_value(0)
                    stmt:finalize()
                    db:close()
                    ngx.say(cjson.encode({ success = true, target = target }))
                else
                    stmt:finalize()
                    db:close()
                    ngx.say(cjson.encode({ success = false, target = ngx.null, message = "Domain target not found" }))
                end
            }
        }

        location / {
            content_by_lua_block {
                local map = _G.DOMAIN_MAP
                if not map then
                    ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
                    return
                end

                local host = string.lower(ngx.var.host):gsub(":%d+$", "")
                local route = map.domains[host]

                if not route then
                    local wildcard = host:match("[^.]+%.(.+)")
                    if wildcard then
                        route = map.domains["*." .. wildcard]
                    end
                end

                if not route then
                    ngx.exit(ngx.HTTP_NOT_FOUND)
                    return
                end

                if route.type == "server" or route.type == "proxy" then
                    local target = route.target
                    if target and target:sub(1, 4) == "app:" then
                        local app_name = target:sub(5)

                        local function read_file(p)
                            local f = io.open(p, "r")
                            if not f then return nil end
                            local d = f:read("*a")
                            f:close()
                            return d
                        end

                        local cjson = require "cjson"
                        local raw = read_file("${appRegistryPath}")
                        local registry = nil
                        if raw then
                            local ok, decoded = pcall(cjson.decode, raw)
                            if ok then registry = decoded end
                        end
                        local apps = registry and registry.apps or {}
                        local now_ms = ngx.now() * 1000
                        local resolved = nil

                        for _, app in pairs(apps) do
                            if app.name == app_name and app.port then
                                local ttl = tonumber(app.ttlMs) or 12000
                                local last_seen = tonumber(app.lastSeenMs) or 0
                                if now_ms - last_seen <= ttl then
                                    resolved = (app.host or "127.0.0.1") .. ":" .. tostring(app.port)
                                    break
                                end
                            end
                        end

                        if not resolved then
                            ngx.status = ngx.HTTP_SERVICE_UNAVAILABLE
                            ngx.say("NetGet app is not available: " .. app_name)
                            return
                        end

                        target = resolved
                    end

                    if not target then
                        ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
                        return
                    end

                    ngx.var.target_url = "http://" .. target
                    ngx.exec("@server")
                elseif route.type == "static" then
                    local root = route.root
                    if not root or root:find("%.%.") then
                        ngx.exit(ngx.HTTP_FORBIDDEN)
                        return
                    end
                    ngx.var.root = root
                    ngx.exec("@dynamic_root")
                else
                    ngx.exit(ngx.HTTP_NOT_FOUND)
                end
            }
        }

        location @dynamic_root {
            internal;
            root $root;
            index index.html index.htm;
            try_files $uri /index.html;
        }

        location @server {
            internal;
            proxy_pass $target_url;
            proxy_http_version                 1.1;
            proxy_set_header Upgrade           $http_upgrade;
            proxy_set_header Connection        'upgrade';
            proxy_set_header Host              $host;
            proxy_cache_bypass                 $http_upgrade;
            proxy_ssl_server_name              on;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host  $host;
            proxy_set_header X-Forwarded-Port  $server_port;
            proxy_connect_timeout              60s;
            proxy_send_timeout                 60s;
            proxy_read_timeout                 60s;
        }

        location ~* \.(conf|sh|sql|env|log)$ {
            deny all;
        }

        error_page 400 401 402 403 404 405 406 407 408 409 410 411 412 413 414 415 416 417 418 421 422 423 424 425 426 428 429 431 451 500 501 502 503 504 505 506 507 508 510 511 /NetgetErrorCodeHandler.html;
        location = /NetgetErrorCodeHandler.html {
            root ${xConfig}/html;
        }
    }
}`;
}

async function writeNginxConfigContent(layout: OpenRestyLayout, content: string): Promise<void> {
    try {
        fs.mkdirSync(layout.confDDir, { recursive: true });
        fs.mkdirSync(layout.logDir, { recursive: true });
        fs.writeFileSync(layout.configFilePath, content, 'utf8');
        return;
    } catch (error: any) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    }

    const heredocCmd = `sh -c 'mkdir -p "${layout.confDDir}" "${layout.logDir}" && tee "${layout.configFilePath}" > /dev/null <<'"'"'NGXEOF'"'"'\n${content}\nNGXEOF'`;
    await handlePermission(
        `write nginx.conf at ${layout.configFilePath}`,
        heredocCmd,
        `Run manually:\nsudo ${heredocCmd}`
    );
}

async function createNginxConfig(layout: OpenRestyLayout): Promise<void> {
    await writeNginxConfigContent(layout, buildNginxConfigContent(layout));
    console.log(chalk.green(`nginx.conf created at ${layout.configFilePath}`));
}

/**
 * Ensures the NGINX configuration file exists, creating it if missing.
 * @memberof module:NetGetX.OpenResty
 */
export const ensureNginxConfigFile = async (): Promise<void> => {
    const layout = detectOpenRestyLayout();

    if (!layout.isSupported) {
        console.log(chalk.yellow('Platform not supported for automatic nginx configuration.'));
        if (layout.installNote) console.log(chalk.gray(layout.installNote));
        return;
    }

    try {
        if (!fs.existsSync(layout.configFilePath)) {
            console.log(chalk.yellow(
                `nginx.conf not found at ${layout.configFilePath}.\n` +
                'This file is required for OpenResty to function correctly.'
            ));
            const { createConfig } = await inquirer.prompt([{
                type: 'confirm',
                name: 'createConfig',
                message: `Create nginx.conf at ${layout.configDir}?`,
                default: true,
            }]);
            if (createConfig) {
                await createNginxConfig(layout);
            }
        } else {
            console.log(chalk.green('nginx.conf already exists.'));
        }
    } catch (error: any) {
        console.error(chalk.red('Error ensuring nginx.conf:', error.message));
    }
};

/**
 * Compares the live nginx.conf against the expected template and offers to reset it.
 * @memberof module:NetGetX.OpenResty
 */
export const setNginxConfigFile = async (): Promise<void> => {
    const layout = detectOpenRestyLayout();

    if (!layout.isSupported) {
        console.log(chalk.yellow('Platform not supported for automatic nginx configuration.'));
        if (layout.installNote) console.log(chalk.gray(layout.installNote));
        return;
    }

    const expectedContent = buildNginxConfigContent(layout);
    const normalize = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

    try {
        const actual = fs.readFileSync(layout.configFilePath, 'utf8');
        if (normalize(actual) !== normalize(expectedContent)) {
            console.log(chalk.yellow(
                `nginx.conf differs from the expected template.\n` +
                `File: ${layout.configFilePath}`
            ));
            const { reset } = await inquirer.prompt([{
                type: 'confirm',
                name: 'reset',
                message: 'Reset nginx.conf to default?',
                default: false,
            }]);
            if (reset) {
                await writeNginxConfigContent(layout, expectedContent);
                console.log(chalk.green('nginx.conf reset to default.'));
            } else {
                console.log(chalk.green('nginx.conf left unchanged.'));
            }
        } else {
            console.log(chalk.green('nginx.conf matches expected template.'));
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(chalk.yellow(`nginx.conf not found at ${layout.configFilePath}. Run activation to create it.`));
            return;
        }
        if (error.code === 'EACCES') {
            console.log(chalk.yellow('Permission denied reading nginx.conf. Attempting with elevated privileges...'));
            await writeNginxConfigContent(layout, expectedContent);
            return;
        }
        console.error(chalk.red('Error in setNginxConfigFile:', error.message));
        throw error;
    }
};
