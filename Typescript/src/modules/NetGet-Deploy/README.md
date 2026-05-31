# NetGet Deploy

Deployment and synchronization utilities that pair the `netget` CLI with the remote deployer API. The code in [netget.cli.ts](../netget.cli.ts) uses the classes in this folder to read local SQLite domain data, package projects, and push them to a remote server that runs the deployer endpoints.

## What the CLI actually does

- **Interactive menu**: Running `netget` with no arguments opens the NetGet main menu (see [netget.cli.ts](../netget.cli.ts)).
- **Non-interactive deploy**: `netget deploy <username> <secret>` authenticates against a local credentials file, then uses `NetGetSync` to push domain configs and optional project bundles.
- **Config-driven sync**: When `--include-projects` is set (without `--targets`), the CLI reads all domains from the local SQLite database and syncs configs; it also deploys every non-`server` target it finds.
- **Target-driven deploy**: With `--targets`, the CLI packages the given paths and deploys them to the remote server. Domains are inferred from the path prefix (e.g., `example.com/var/www/site`) unless `--domain` is provided.

## Inputs and configuration

### Deploy configuration (optional)
The CLI can read a JSON file (default `~/.this/me/deploy.config.json`) when `--config` is provided:

```json
{
  "remoteServer": "https://your-remote-server.com",
  "remoteApiKey": "your-api-key",
  "localDbPath": "/path/to/domains.db",
  "projectsBasePath": "/var/www"
}
```

Flags override file values: `--server` replaces `remoteServer` and is required when no config is provided.

### Credentials file
`netget deploy` expects credentials (default path: `~/.this/me/pplalo/credentials.json`). Supported shapes:

```json
{ "username": "user", "password": "secret" }
```
```json
{ "users": [ { "username": "user", "password": "secret" } ] }
```
```json
{ "user": "secret", "other": "pass" }
```

## CLI flags (non-interactive deploy)

```
netget deploy <username> <secret> [options]

--server <url>          Override remote server URL (required if no config file)
--config <path>         Path to deploy config JSON
--creds <path>          Path to credentials JSON
--targets <json|csv>    JSON array or comma-separated list of project roots
--domain <domain>       Explicit domain when it cannot be inferred from target
--include-projects      Run config-driven sync and deploy all non-server targets
```

Behavior summary:
- With `--targets`: each path is zipped, uploaded, and its domain config is synced.
- Without `--targets` but with `--include-projects`: syncs all domains from the local DB; deploys any domain whose `type` is not `server`.
- Otherwise: the CLI exits with a helpful message.

Enable debug logging with `NETGET_DEBUG=1` (prints argv and early state).

## Local sync logic (NetGetSync)

- Reads domains from the SQLite `domains` table (`domain, subdomain, email, sslMode, sslCertificate, sslCertificateKey, target, type, projectPath, owner`).
- Checks remote health at `GET /deploy/health` (Bearer token required).
- Syncs domain configs via `POST /deploy/sync/domains` with `{ domains, timestamp }`.
- Packages projects into ZIP archives (excludes `node_modules`, `.git`, `.env`, logs, `dist`, `build`, `.DS_Store`).
- Uploads bundles to `POST /deploy/sync/deploy` using multipart form data.

## Remote deployer behavior (RemoteDeployer)

- Stores domain records in SQLite (defaults to `getNetgetDataDir()/domains.db`).
- Writes deployments to `<projectsBasePath>/<domain>/dist` (defaults to `/var/www`).
- On upload, replaces existing `dist`, unzips the bundle, attempts `npm install --production`, and runs `npm run build` when a build script exists.
- Exposes helpers to read configs (`GET /deploy/sync/domains`), update configs (`POST /deploy/sync/domains`), deploy bundles (`POST /deploy/sync/deploy`), and report health (`GET /deploy/health`).

## Examples

**Deploy explicit targets**

```bash
NETGET_DEBUG=1 netget deploy user secret \
  --server https://remote.example.com \
  --targets "[\"/opt/projects/example.com\"]"
```

**Config-driven sync including projects**

```bash
netget deploy user secret \
  --config ~/deploy.config.json \
  --include-projects
```

**Deploy when domain cannot be inferred from path**

```bash
netget deploy user secret \
  --server https://remote.example.com \
  --targets /opt/sites/app \
  --domain app.example.com
```

## Operational notes

- Ensure the remote API key matches the one configured on the deployer; all deploy calls use Bearer auth.
- When inferring domains, the CLI treats the text before the first `/` in a target as the domain if it contains a dot.
- Temporary ZIPs are written to `./temp` during packaging and deleted after upload.
- Remote deployments may install and build; ensure the target has the necessary build tooling available.

## Troubleshooting

- **Invalid credentials**: Check the credentials file path and shape; the CLI rejects unknown usernames/passwords.
- **Missing server**: Provide `--server` or set `remoteServer` in the config file.
- **No targets**: Supply `--targets` or `--include-projects`; otherwise the CLI exits without action.
- **Health check errors**: Verify `GET /deploy/health` on the remote and confirm the API key.

## License

MIT License - see LICENSE for details.
