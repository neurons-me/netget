import fs from 'fs';
import chalk from 'chalk';
import path from 'path';

/**
 * Creates the main nginx.conf file with the specified content.
 * @param {string} configPath - The path where the nginx.conf file will be created.
 */
const createNginxConfig = (configPath) => {
    const nginxConfigContent = `
events {
    worker_connections 1024;
}

http {
    lua_shared_dict ssl_cache 10m;
    lua_package_path "/usr/local/openresty/lualib/?.lua;;";
    
    server {
        listen 80;
        server_name _;

        # Redirect all HTTP traffic to HTTPS
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl;
        server_name _;

        # Default SSL configuration
        ssl_certificate /etc/ssl/certs/cert.pem;  # Updated to use self-signed certificate
        ssl_certificate_key /etc/ssl/private/privkey.pem;  # Updated to use self-signed key

        set $target_url "";
        set $root "";

        access_by_lua_block {
            -- Get the requested domain
            local ssl_cache = ngx.shared.ssl_cache
            local host = ngx.var.host

            if not host then
                ngx.log(ngx.ERR, "Host not found in request")
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end
        }

        # Dynamic SSL configuration
        ssl_certificate_by_lua_block {
            local sqlite = require "lsqlite3"
            local db, err = sqlite.open("/opt/.get/domains.db")  -- Corrected method call

            if not db then
                ngx.log(ngx.ERR, "Failed to open SQLite database: ", err)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Query the domain configuration
            local ssl_cache = ngx.shared.ssl_cache
            local host = ssl_cache:get("host")

            if not host then
                ngx.log(ngx.ERR, "Host not found in shared dictionary")
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Load certificates
            local stmt, err = db:prepare("SELECT sslCertificate, sslCertificateKey FROM domains WHERE domain = ?")

            if not stmt then
                ngx.log(ngx.ERR, "Failed to prepare SQL statement: ", err)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            local res, err = stmt:bind_values(host)
            if not res then
                ngx.log(ngx.ERR, "Failed to bind values to SQL statement: ", err)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            res, err = stmt:step()
            if not res then
                ngx.log(ngx.ERR, "Domain not configured: ", host)
                return ngx.exit(ngx.HTTP_NOT_FOUND)
            end

            local sslCertificate = stmt:get_value(0)
            local sslCertificateKey = stmt:get_value(1)

            stmt:finalize()

            if not sslCertificate or not sslCertificateKey then
                ngx.log(ngx.ERR, "SSL configuration missing for domain: ", host)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end
        }

        location / {
            # Lua block to handle dynamic content
            content_by_lua_block {
                local sqlite = require "lsqlite3"
                local db, err = sqlite.open("/opt/.get/domains.db")  -- Corrected method call

                if not db then
                    ngx.say("Failed to open SQLite database: ", err)
                    return
                end
                
                local ssl_cache = ngx.shared.ssl_cache
                local host = ssl_cache:get("host")

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

                res, err = stmt:step()
                
                if not res then
                    ngx.status = ngx.HTTP_NOT_FOUND
                    ngx.say("Domain not configured")
                    return
                end

                local type = stmt:get_value(0)
                local target = stmt:get_value(1)

                stmt:finalize()
                
                if type == "static" then
                    ngx.var.root = target
                    ngx.exec("@dynamic_root")
                elseif type == "proxy" then
                    ngx.var.target_url = "http://localhost:" .. target
                    ngx.exec("@proxy")
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
            index index.html index.htm index.nginx-debian.html;
        }

        # Internal location block to proxy dynamic content
        location @proxy {
            internal;
            proxy_pass $target_url;
        }
    }
}`;

    const nginxConfigPath = path.join(configPath, 'nginx.conf');
    fs.writeFileSync(nginxConfigPath, nginxConfigContent, 'utf8');
    console.log(chalk.green(`nginx.conf created successfully at ${nginxConfigPath}`));
};

export { createNginxConfig };
