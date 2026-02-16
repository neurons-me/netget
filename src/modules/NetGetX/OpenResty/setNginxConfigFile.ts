import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { handlePermission } from '../../utils/handlePermissions.ts';
import { loadXConfig } from '../config/xConfig.ts';
import { getNetgetDataDir } from '../../../utils/netgetPaths.js';

/**
 * Configuration file in order to set the nginx.conf file for OpenResty.
 * The file will be created at /usr/local/openresty/nginx/conf/nginx.conf
 * @module NetGetX
 * @submodule OpenResty
 */
const xConfig = getNetgetDataDir();
const configPath: string = '/usr/local/openresty/nginx/conf';
const nginxConfigPath: string = path.join(configPath, 'nginx.conf');
const sslSelfSignedCertPath: string = '/etc/ssl/certs/nginx-selfsigned.crt';
const sslSelfSignedKeyPath: string = '/etc/ssl/private/nginx-selfsigned.key';
const sqliteDatabasePath: string = path.join(xConfig, 'domains.db');

/**
 * The content of the nginx.conf file.
 * The file contains the configuration for the OpenResty server, including the SSL certificate and key loading logic.
 * @memberof module:NetGetX.OpenResty
 */
const nginxConfigContent = `
user root;

events {
    worker_connections 1024;
}

http {
    resolver    8.8.8.8 8.8.4.4 valid=300s;
    include     mime.types;
    include     /usr/local/openresty/nginx/conf/conf.d/*.conf;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    default_type application/octet-stream;

    # Gzip settings
    gzip on;
    gzip_disable "msie6";
    # Removed Strict-Transport-Security to allow HTTP access without certificates

    lua_shared_dict ssl_cache 10m;
    lua_package_path "/usr/local/share/lua/5.1/?.lua;/usr/local/openresty/lualib/?.lua;/usr/local/openresty/nginx/lua/?.lua;;";
    
    error_log /usr/local/openresty/nginx/logs/error.log;
    access_log /usr/local/openresty/nginx/logs/access.log;
    
    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        server_name _;

        root ${xConfig}/html;

        # Redirect all error codes to NetgetErrorCodeHandler.html
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

        # Default SSL configuration
        ssl_certificate ${sslSelfSignedCertPath};  # Updated to use self-signed certificate
        ssl_certificate_key ${sslSelfSignedKeyPath};  # Updated to use self-signed key  

        set $target_url "";
        set $root "";

        access_by_lua_block {
            -- Get the requested domain
            local ssl_cache = ngx.shared.ssl_cache
            local host = ngx.var.host
            local wildcard_domain = "*." .. host:match("[^.]+%.(.+)")

            -- Store the requested domain in the shared dictionary
            if host then
                ssl_cache:set("host", host)
                ssl_cache:set("wildcard_domain", wildcard_domain)
            end


            if not host then
                -- ngx.log(ngx.ERR, "Host is nil")
                return ngx.exit(ngx.HTTP_BAD_REQUEST)
            end
        }

        ssl_certificate_by_lua_block {
            local ssl = require "ngx.ssl"
            local sqlite = require "lsqlite3"

            local ok, err = ssl.clear_certs()
                if not ok then
                    -- ngx.log(ngx.ERR, "failed to clear existing (fallback) certificates")
                    return ngx.exit(ngx.ERROR)
                end

            -- Get the requested SNI (Server Name Indication)
            local host, err = ssl.server_name()
            if not host then
                -- ngx.log(ngx.ERR, "Failed to retrieve SNI: ", err)
                return ngx.exit(ngx.HTTP_BAD_REQUEST)
            end

            -- ngx.log(ngx.ERR, "Requested host: ", host)

            -- Open the SQLite database
            local db, err = sqlite.open("${sqliteDatabasePath}")
            if not db then
                -- ngx.log(ngx.ERR, "Failed to open SQLite database: ", err)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Prepare SQL query to find SSL certificate file paths
            local stmt, err = db:prepare("SELECT sslCertificate, sslCertificateKey FROM domains WHERE domain = ?")
            if not stmt then
                -- ngx.log(ngx.ERR, "Failed to prepare SQL statement: ", err)
                db:close()
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Bind the requested host to the query
            local res, err = stmt:bind_values(host)
            if not res then
                -- ngx.log(ngx.ERR, "Failed to bind values to SQL statement: ", err)
                stmt:finalize()
                db:close()
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Execute the query
            local result = stmt:step()
            local cert_path, key_path

            if result == sqlite.ROW then
                cert_path = stmt:get_value(0)
                key_path = stmt:get_value(1)
            else
                -- ngx.log(ngx.ERR, "No exact match for host: ", host, ", trying wildcard domain")
                stmt:finalize()

                -- Prepare a new query for wildcard domain
                stmt, err = db:prepare("SELECT sslCertificate, sslCertificateKey FROM domains WHERE domain = ?")
                if not stmt then
                    -- ngx.log(ngx.ERR, "Failed to prepare SQL statement for wildcard domain: ", err)
                    db:close()
                    return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
                end

                -- Construct wildcard domain
                local wildcard_domain = "*." .. host:match("[^.]+%.(.+)")
                res, err = stmt:bind_values(wildcard_domain)
                if not res then
                    -- ngx.log(ngx.ERR, "Failed to bind values to SQL statement for wildcard domain: ", err)
                    stmt:finalize()
                    db:close()
                    return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
                end

                -- Execute the query for wildcard domain
                result = stmt:step()
                if result == sqlite.ROW then
                    cert_path = stmt:get_value(0)
                    key_path = stmt:get_value(1)
                else
                    -- ngx.log(ngx.ERR, "Wildcard domain not configured: ", wildcard_domain)
                stmt:finalize()
                db:close()
                return ngx.exit(ngx.HTTP_NOT_FOUND)
                end
            end

            stmt:finalize()
            db:close()

            if not cert_path or not key_path then
                -- ngx.log(ngx.ERR, "SSL configuration missing for domain: ", host)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Load the SSL certificate
            local my_load_certificate_chain = function(cert_path)
                local file, err = io.open(cert_path, "r")
                if not file then
                    -- ngx.log(ngx.ERR, "Failed to open certificate file: ", err)
                    return nil
                end

                local pem_cert_chain = file:read("*a")
                file:close()
                return pem_cert_chain
            end

            --Load the SSL private key 
            local my_load_private_key = function(key_path)
                local file, err = io.open(key_path, "r")
                if not file then
                    -- ngx.log(ngx.ERR, "Failed to open private key file: ", err)
                    return nil
                end

                local pem_private_key = file:read("*a")
                file:close()
                return pem_private_key
            end

            
            local pem_cert_chain = assert(my_load_certificate_chain(cert_path), "Failed to load certificate chain")

            local der_cert_chain, err = ssl.cert_pem_to_der(pem_cert_chain)
            if not der_cert_chain then
                -- ngx.log(ngx.ERR, "Failed to convert certificate chain to DER: ", err)
                return ngx.exit(ngx.ERROR)
            end

            local ok, err = ssl.set_der_cert(der_cert_chain)
            if not ok then
                -- ngx.log(ngx.ERR, "Failed to set DER certificate: ", err)
                return ngx.exit(ngx.ERROR)
            end

            local pem_pkey = assert(my_load_private_key(key_path), "Failed to load private key")

            local der_pkey, err = ssl.priv_key_pem_to_der(pem_pkey)
            if not der_pkey then
                -- ngx.log(ngx.ERR, "Failed to convert private key to DER: ", err)
                return ngx.exit(ngx.ERROR)
            end

            local ok, err = ssl.set_der_priv_key(der_pkey)
            if not ok then
                -- ngx.log(ngx.ERR, "Failed to set DER private key: ", err)
                return ngx.exit(ngx.ERROR)
            end

        }

        location /domain-target {
            # Endpoint to get domain target information
            default_type application/json;
            content_by_lua_block {
                local sqlite = require "lsqlite3"
                local cjson = require "cjson"
                
                -- Get domain from query parameter or Host header
                local domain = ngx.var.arg_domain or ngx.var.host
                if domain then
                    domain = domain:match("([^:]+)") -- Remove port if present
                end
                
                if not domain then
                    ngx.status = ngx.HTTP_BAD_REQUEST
                    ngx.say(cjson.encode({
                        success = false,
                        error = "Domain not specified"
                    }))
                    return
                end
                
                local db, err = sqlite.open("${sqliteDatabasePath}")
                if not db then
                    ngx.status = ngx.HTTP_INTERNAL_SERVER_ERROR
                    ngx.say(cjson.encode({
                        success = false,
                        error = "Failed to open SQLite database"
                    }))
                    return
                end
                
                local stmt, err = db:prepare("SELECT target FROM domains WHERE domain = ?")
                if not stmt then
                    ngx.status = ngx.HTTP_INTERNAL_SERVER_ERROR
                    ngx.say(cjson.encode({
                        success = false,
                        error = "Failed to prepare SQL statement"
                    }))
                    db:close()
                    return
                end
                
                local res, err = stmt:bind_values(domain)
                if not res then
                    ngx.status = ngx.HTTP_INTERNAL_SERVER_ERROR
                    ngx.say(cjson.encode({
                        success = false,
                        error = "Failed to bind values to SQL statement"
                    }))
                    stmt:finalize()
                    db:close()
                    return
                end
                
                res = stmt:step()
                if res == sqlite.ROW then
                    local target = stmt:get_value(0)
                    stmt:finalize()
                    db:close()
                    
                    ngx.say(cjson.encode({
                        success = true,
                        target = target
                    }))
                else
                    stmt:finalize()
                    db:close()
                    
                    ngx.say(cjson.encode({
                        success = false,
                        target = ngx.null,
                        message = "Domain target not found"
                    }))
                end
            }
        }

        location / {
            # Lua block to handle dynamic content
            content_by_lua_block {
                local sqlite = require "lsqlite3"
                local db, err = sqlite.open("${sqliteDatabasePath}")  -- Corrected method call

                if not db then
                    ngx.say("Failed to open SQLite database: ", err)
                    return
                end
                
                local ssl_cache = ngx.shared.ssl_cache
                local host = ssl_cache:get("host")
                local wildcard_domain = ssl_cache:get("wildcard_domain")

                local stmt, err = db:prepare("SELECT type, target FROM domains WHERE domain = ?")

                if not stmt then
                    ngx.say("Failed to prepare SQL statement: ", err)
                    return
                end

                local res, err = stmt:bind_values(host)

                if not res then
                    ngx.say("Failed to bind values to SQL statement: ", err)
                    return
                end

                res = stmt:step()
                if res == sqlite.ROW then
                    type = stmt:get_value(0)
                    -- ngx.log(ngx.ERR, "Type: ", type)
                    target = stmt:get_value(1)
                    -- ngx.log(ngx.ERR, "Target: ", target)

                    stmt:finalize()
                    db:close()
                else
                    -- ngx.log(ngx.ERR, "Host not found, trying wildcard domain: ", wildcard_domain)
                    stmt:finalize()

                    stmt, err = db:prepare("SELECT type, target FROM domains WHERE domain = ?")
                    if not stmt then
                        ngx.say("Failed to prepare SQL statement for wildcard domain: ", err)
                        db:close()
                        return
                    end

                    res, err = stmt:bind_values(wildcard_domain)
                    if not res then
                        ngx.say("Failed to bind values to SQL statement for wildcard domain: ", err)
                        stmt:finalize()
                        db:close()
                        return
                    end

                    res = stmt:step()
                    if res == sqlite.ROW then
                        type = stmt:get_value(0)
                        -- ngx.log(ngx.ERR, "Type: ", type)
                        target = stmt:get_value(1)
                        -- ngx.log(ngx.ERR, "Target: ", target)

                        stmt:finalize()
                        db:close()
                    else
                        ngx.status = ngx.HTTP_NOT_FOUND
                        ngx.say("Wildcard domain not configured")
                        stmt:finalize()
                        db:close()
                        return
                    end
                end
                
                if type == "static" then
                    ngx.var.root = target
                    ngx.exec("@dynamic_root")
                elseif type == "server" then
                    ngx.var.target_url = "http://127.0.0.1:" .. target
                    -- ngx.log(ngx.ERR, "Proxying to: ", ngx.var.target_url)
                    ngx.exec("@server")
                else
                    ngx.status = ngx.HTTP_NOT_FOUND
                    ngx.say("Invalid configuration for domain")
                end
                
            }
        }
            # Internal location block to serve static content
            location @dynamic_root {
                internal;
                root $root; 
                # allow all;
                # autoindex on;
                index index.html index.htm;

                try_files $uri /index.html;
            }

            

        # Internal location block to proxy dynamic content
        location @server {
            internal;
            proxy_pass $target_url;
            proxy_http_version                 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass                 $http_upgrade;

            # Proxy SSL
            proxy_ssl_server_name              on;

            # Proxy headers
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host  $host;
            proxy_set_header X-Forwarded-Port  $server_port;

            # Proxy timeouts
            proxy_connect_timeout       60s;
            proxy_send_timeout          60s;
            proxy_read_timeout          60s;
        }

        # Bloquear acceso a archivos sensibles
        location ~* \.(conf|sh|sql|env|log)$ {
            deny all;
        }

        # Redirect all error codes to NetgetErrorCodeHandler.html
        error_page 400 401 402 403 404 405 406 407 408 409 410 411 412 413 414 415 416 417 418 421 422 423 424 425 426 428 429 431 451 500 501 502 503 504 505 506 507 508 510 511 /NetgetErrorCodeHandler.html;
        location = /NetgetErrorCodeHandler.html {
            root ${xConfig}/html;
        }

    }
}`;

/**
 * Creates the main nginx.conf file with the specified content.
 * @param {string} configPath - The path where the nginx.conf file will be created.
 */
const createNginxConfig = (configPath: string) => {
    const nginxConfigPath = path.join(configPath, 'nginx.conf');
    fs.writeFileSync(nginxConfigPath, nginxConfigContent, 'utf8');
    console.log(chalk.green(`nginx.conf created successfully at ${nginxConfigPath}`));
};

/**
 * Ensures the NGINX configuration file exists.
 * @memberof module:NetGetX.OpenResty
 * @returns Promise that resolves when configuration is ensured.
 */
const ensureNginxConfigFile = async (): Promise<void> => {
    
    try {
        if (!fs.existsSync(configPath)) {
            console.log(chalk.blue(`Config directory would be created: ${configPath}`));
        }
        
        if (!fs.existsSync(nginxConfigPath)) {
            console.log(chalk.yellow(
                `The nginx.conf file does not exist at ${nginxConfigPath}.\n` +
                'This file is essential for OpenResty to function properly, as it contains the main server configuration, including security rules, SSL certificates, and proxy routes.\n' +
                'Without this file, the server will not be able to start or securely manage domains.'
            ));
            console.log(chalk.blue('NGINX config file would be created with default content'));
            const { createConfig } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'createConfig',
                    message: `Do you want to create the nginx.conf file now at ${configPath}?`,
                    default: true,
                },
            ]);
            if (createConfig) {
                createNginxConfig(configPath);
            } else {
            console.log(chalk.green('NGINX config file already exists'));
            }
        } else {
            console.log(chalk.green('NGINX config file already exists'));
        }
    } catch (error: any) {
        console.error(chalk.red('Error ensuring NGINX config file:', error.message));
    }
};

/**
 * Sets the NGINX configuration file content.
 * @memberof module:NetGetX.OpenResty
 * @returns Promise that resolves when configuration is set.
 */
const setNginxConfigFile = async (): Promise<void> => {    
    try {
        const nginxActualContent: string = fs.readFileSync(nginxConfigPath, 'utf8');
        // Normalize both contents for comparison: trim, normalize line endings, remove trailing whitespace
        const normalize = (str: string) => str.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
        if (normalize(nginxActualContent) !== normalize(nginxConfigContent)) {
            console.log(chalk.yellow('nginx.conf file content is different from expected.\n' +
                'In case of issues with OpenResty, consider resetting the configuration file to default.'));
            const { setDefaultConfig } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'setDefaultConfig',
                    message: `Do you want to reset the nginx.conf file to default content?`,
                    default: false,
                },
            ]);
            if (setDefaultConfig) {
                // Use a here-document to preserve formatting and structure
                const heredocCmd = `sudo tee ${nginxConfigPath} > /dev/null <<'EOF'\n${nginxConfigContent}\nEOF`;
                await handlePermission(
                    'Setting NGINX config file requires elevated privileges.',
                    heredocCmd,
                    'Please run the following command manually to set the NGINX config file:\n' + heredocCmd
                );
                console.log(chalk.green('NGINX configuration reset to default successfully'));
            } else {
                console.log(chalk.green('NGINX config file left unchanged.'));
            }
        } else {
            console.log(chalk.green('NGINX config file already matches the default.'));
        }
    } catch (error: any) {
        if (error.code === 'EACCES') {
            console.log(chalk.yellow('Permission denied when trying to set NGINX config file. Attempting with elevated privileges...'));
            try {
                const heredocCmd = `sudo tee ${nginxConfigPath} > /dev/null <<'EOF'\n${nginxConfigContent}\nEOF`;
                await handlePermission(
                    'Setting NGINX config file requires elevated privileges.',
                    heredocCmd,
                    'Please run the following command manually to set the NGINX config file:\n' + heredocCmd
                );
                console.log(chalk.green('NGINX configuration set successfully with elevated privileges'));
                return;
            } catch (permError) {
                console.error(chalk.red('Failed to set NGINX config file with elevated privileges.'));
                throw permError;
            }
        }
        console.error(chalk.red('Error setting NGINX config file:', error.message));
        throw error;
    }
};

export { ensureNginxConfigFile, setNginxConfigFile, nginxConfigContent };