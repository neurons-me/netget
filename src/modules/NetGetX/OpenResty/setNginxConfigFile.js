import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getDomainsDbPath, getHtmlRootDir } from '../../../utils/netgetPaths.js';

/**
 * Configuration file in order to set the nginx.conf file for OpenResty.
 * The file will be created at /usr/local/openresty/nginx/conf/nginx.conf
 * @module NetGetX
 * @submodule OpenResty
 */

const configPath = '/usr/local/openresty/nginx/conf';
const nginxConfigPath = path.join(configPath, 'nginx.conf');
const sslSelfSignedCertPath = '/etc/ssl/certs/cert.pem';
const sslSelfSignedKeyPath = '/etc/ssl/private/privkey.key';
const sqliteDatabasePath = getDomainsDbPath();
const htmlRoot = getHtmlRootDir();

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

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    default_type application/octet-stream;

    # Gzip settings
    gzip on;
    gzip_disable "msie6";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    lua_shared_dict ssl_cache 10m;
    lua_package_path "/usr/local/share/lua/5.1/?.lua;/usr/local/openresty/lualib/?.lua;;";
    
    error_log /usr/local/openresty/nginx/logs/error.log;
    access_log /usr/local/openresty/nginx/logs/access.log;
    
    server {
        listen 80;
        listen [::]:80;
        server_name _;

        # Redirect all HTTP traffic to HTTPS
        return 301 https://$host$request_uri;
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
                ngx.log(ngx.ERR, "Host is nil")
                return ngx.exit(ngx.HTTP_BAD_REQUEST)
            end
        }

        ssl_certificate_by_lua_block {
            local ssl = require "ngx.ssl"
            local sqlite = require "lsqlite3"

            local ok, err = ssl.clear_certs()
                if not ok then
                    ngx.log(ngx.ERR, "failed to clear existing (fallback) certificates")
                    return ngx.exit(ngx.ERROR)
                end

            -- Get the requested SNI (Server Name Indication)
            local host, err = ssl.server_name()
            if not host then
                ngx.log(ngx.ERR, "Failed to retrieve SNI: ", err)
                return ngx.exit(ngx.HTTP_BAD_REQUEST)
            end

            ngx.log(ngx.ERR, "Requested host: ", host)

            -- Open the SQLite database
            local db, err = sqlite.open("${sqliteDatabasePath}")
            if not db then
                ngx.log(ngx.ERR, "Failed to open SQLite database: ", err)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Prepare SQL query to find SSL certificate file paths
            local stmt, err = db:prepare("SELECT sslCertificate, sslCertificateKey FROM domains WHERE domain = ?")
            if not stmt then
                ngx.log(ngx.ERR, "Failed to prepare SQL statement: ", err)
                db:close()
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Bind the requested host to the query
            local res, err = stmt:bind_values(host)
            if not res then
                ngx.log(ngx.ERR, "Failed to bind values to SQL statement: ", err)
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
                ngx.log(ngx.ERR, "No exact match for host: ", host, ", trying wildcard domain")
                stmt:finalize()

                -- Prepare a new query for wildcard domain
                stmt, err = db:prepare("SELECT sslCertificate, sslCertificateKey FROM domains WHERE domain = ?")
                if not stmt then
                    ngx.log(ngx.ERR, "Failed to prepare SQL statement for wildcard domain: ", err)
                    db:close()
                    return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
                end

                -- Construct wildcard domain
                local wildcard_domain = "*." .. host:match("[^.]+%.(.+)")
                res, err = stmt:bind_values(wildcard_domain)
                if not res then
                    ngx.log(ngx.ERR, "Failed to bind values to SQL statement for wildcard domain: ", err)
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
                    ngx.log(ngx.ERR, "Wildcard domain not configured: ", wildcard_domain)
                stmt:finalize()
                db:close()
                return ngx.exit(ngx.HTTP_NOT_FOUND)
                end
            end

            stmt:finalize()
            db:close()

            if not cert_path or not key_path then
                ngx.log(ngx.ERR, "SSL configuration missing for domain: ", host)
                return ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
            end

            -- Load the SSL certificate
            local my_load_certificate_chain = function(cert_path)
                local file, err = io.open(cert_path, "r")
                if not file then
                    ngx.log(ngx.ERR, "Failed to open certificate file: ", err)
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
                    ngx.log(ngx.ERR, "Failed to open private key file: ", err)
                    return nil
                end

                local pem_private_key = file:read("*a")
                file:close()
                return pem_private_key
            end

            
            local pem_cert_chain = assert(my_load_certificate_chain(cert_path), "Failed to load certificate chain")

            local der_cert_chain, err = ssl.cert_pem_to_der(pem_cert_chain)
            if not der_cert_chain then
                ngx.log(ngx.ERR, "Failed to convert certificate chain to DER: ", err)
                return ngx.exit(ngx.ERROR)
            end

            local ok, err = ssl.set_der_cert(der_cert_chain)
            if not ok then
                ngx.log(ngx.ERR, "Failed to set DER certificate: ", err)
                return ngx.exit(ngx.ERROR)
            end

            local pem_pkey = assert(my_load_private_key(key_path), "Failed to load private key")

            local der_pkey, err = ssl.priv_key_pem_to_der(pem_pkey)
            if not der_pkey then
                ngx.log(ngx.ERR, "Failed to convert private key to DER: ", err)
                return ngx.exit(ngx.ERROR)
            end

            local ok, err = ssl.set_der_priv_key(der_pkey)
            if not ok then
                ngx.log(ngx.ERR, "Failed to set DER private key: ", err)
                return ngx.exit(ngx.ERROR)
            end

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
                    ngx.log(ngx.ERR, "Type: ", type)
                    target = stmt:get_value(1)
                    ngx.log(ngx.ERR, "Target: ", target)

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

        # Error page redirection
        error_page 500 /500.html;
        location = /500.html {
            root ${htmlRoot};
        }

        error_page 502 /502.html;
        location = /502.html {
            root ${htmlRoot};
        }
    }
}`;

/**
 * Creates the main nginx.conf file with the specified content.
 * @param {string} configPath - The path where the nginx.conf file will be created.
 */
const createNginxConfig = (configPath) => {
    const nginxConfigPath = path.join(configPath, 'nginx.conf');
    fs.writeFileSync(nginxConfigPath, nginxConfigContent, 'utf8');
    console.log(chalk.green(`nginx.conf created successfully at ${nginxConfigPath}`));
};

const validateNginxConfig = () => {
    if (fs.existsSync(nginxConfigPath)) {
        const existingContent = fs.readFileSync(nginxConfigPath, 'utf8');
        return existingContent === nginxConfigContent;
    }
    return false;
};



const setNginxConfigFile = async () => {
    if (!validateNginxConfig()) {
        try{
            console.log(chalk.yellow('The existing nginx.conf file is different from the expected configuration. This may cause unexpected behavior.'));
            const { createConfig } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'createConfig',
                    message: `Do you want to proceed and overwrite the current nginx.conf file at ${configPath}?`,
                    default: false,
                },
            ]);
    
            if (createConfig) {
                if (validateNginxConfig()) {
                    console.log(chalk.yellow('nginx.conf already exists and is up to date.'));
                } else {
                    createNginxConfig(configPath);
                }
            } else {
                console.log(chalk.red('Operation cancelled by the user.'));
            }
        }
        catch (error) {
            console.log(chalk.red('An error occurred: ', error));
        }
    }
};

/**
 * Checks if nginx.conf exists, and if not, prompts the user to create it,
 * explaining why it is important.
 */
const ensureNginxConfigFile = async () => {
    if (!fs.existsSync(nginxConfigPath)) {
        console.log(chalk.yellow(
            `The nginx.conf file does not exist at ${nginxConfigPath}.\n` +
            'This file is essential for OpenResty to function properly, as it contains the main server configuration, including security rules, SSL certificates, and proxy routes.\n' +
            'Without this file, the server will not be able to start or securely manage domains.'
        ));
        try {
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
                console.log(chalk.red('Operation cancelled by the user. The server will not work without nginx.conf.'));
            }
        } catch (error) {
            console.log(chalk.red('An error occurred: ', error));
        }
    } else {
        console.log(chalk.green('The nginx.conf file already exists.'));
    }
};

export { setNginxConfigFile as setNginxConfigFile, ensureNginxConfigFile };
