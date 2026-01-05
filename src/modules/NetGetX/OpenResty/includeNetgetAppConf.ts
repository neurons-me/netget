import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { handlePermission } from '../../utils/handlePermissions.ts';
import { getNetgetAppConfContent } from './setNginxConfigRoutes.ts';

/**
 * Instala e incluye el archivo netget_app.conf dentro de nginx.conf de OpenResty.
 * - Copia el conf a /usr/local/openresty/nginx/conf/conf.d/netget_app.conf
 * - Asegura que nginx.conf incluya conf.d/*.conf dentro del bloque http {}
 */
async function includeNetgetAppConf() {
  const nginxRoot = '/usr/local/openresty/nginx/conf';
  const confdDir = path.join(nginxRoot, 'conf.d');
  const destConf = path.join(confdDir, 'netget_app.conf');
  const luaTargetDir = '/usr/local/openresty/nginx/lua';
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  console.log(chalk.gray('Source directory:', __dirname));

  // 1) Generar conf dinámico y copiarlo a conf.d
  const tmpConfPath = path.join('/tmp', 'netget_app.conf');
  const confContent = getNetgetAppConfContent();
  fs.writeFileSync(tmpConfPath, confContent, 'utf8');
  const mkAndCopy = `mkdir -p ${confdDir} && sudo cp -f ${tmpConfPath} ${destConf}`;
  await handlePermission(
    `Create ${confdDir} and copy netget_app.conf`,
    mkAndCopy,
    `Create the directory and copy the file manually:\n  sudo mkdir -p ${confdDir}\n  sudo cp -f ${tmpConfPath} ${destConf}`
  );
  
  // 2) Ensure include conf.d/*.conf inside the http {} block
  const nginxConf = path.join(nginxRoot, 'nginx.conf');

  // Ensure required env directives exist at top-level (before any http { )
  const requiredEnv = [ 'JWT_SECRET', 'CORS_ALLOWED_ORIGINS', 'NODE_ENV', 'USE_HTTPS' ];
  try {
    const current = fs.readFileSync(nginxConf, 'utf8');
    const missing: string[] = [];
    for (const v of requiredEnv) {
      const regex = new RegExp(`^env\\s+${v}\\s*;`, 'm');
      if (!regex.test(current)) missing.push(v);
    }
    if (missing.length) {
      const appendLines = missing.map(v => `env ${v};`).join('\n') + '\n';
      const tmpFile = nginxConf + '.tmp_netget_env';
      fs.writeFileSync(tmpFile, appendLines + current, 'utf8');
      const moveCmd = `mv -f ${tmpFile} ${nginxConf}`;
      await handlePermission(
        `Add env directives for: ${missing.join(', ')}`,
        moveCmd,
        `Prepend manually to ${nginxConf} (top-level, outside http {}):\n${appendLines}`
      );
      console.log(chalk.green(`Added env directives: ${missing.join(', ')}`));
    } else {
      console.log(chalk.green('All required env directives already exist.'));
    }
  } catch (e:any) {
    console.log(chalk.yellow('Could not verify/add env directives: ' + e.message));
  }

  // 3) Test and optional reload
  const { reload } = await inquirer.prompt<{ reload: boolean }>([
    { type: 'confirm', name: 'reload', message: 'Test configuration (openresty -t) and reload OpenResty now?', default: true }
  ]);

  if (reload) {
    // Copy Lua folder (handlers, middleware) if present
    const srcLuaDir = path.join(__dirname, 'lua');
    if (fs.existsSync(srcLuaDir)) {
      const copyLuaCmd = `mkdir -p ${luaTargetDir} && sudo cp -R ${srcLuaDir}/* ${luaTargetDir}/`;
      await handlePermission(
        'Install/Update lua scripts into nginx prefix',
        copyLuaCmd,
        `Manual copy:
          sudo mkdir -p ${luaTargetDir}
          sudo cp -R ${srcLuaDir}/* ${luaTargetDir}/`
      );
      console.log(chalk.green('Lua scripts copied to nginx prefix.'));
    } else {
      console.log(chalk.yellow(`Lua source directory not found: ${srcLuaDir}`));
    }

    // Ensure lua_package_path directive (must be inside http block in nginx.conf). We'll append a hint if missing.
    try {
      const nginxConfContent = fs.readFileSync(path.join(nginxRoot, 'nginx.conf'), 'utf8');
      if (!/lua_package_path\s+"[^"]*lua\/\?\.lua/.test(nginxConfContent)) {
        console.log(chalk.yellow('lua_package_path not detected in nginx.conf. Please add inside http { }:' ));
        console.log(chalk.yellow(`    lua_package_path "${luaTargetDir}/?.lua;${luaTargetDir}/?/init.lua;;";`));
      } else {
        console.log(chalk.green('lua_package_path already configured.'));
      }
    } catch (e:any) {
      console.log(chalk.yellow('Could not verify lua_package_path: ' + e.message));
    }

    await handlePermission(
      'Test OpenResty configuration',
      'openresty -t',
      'Run: sudo openresty -t'
    );
    await handlePermission(
      'Reload OpenResty',
      'systemctl reload openresty || openresty -s reload',
      'Reload manually with:\n  sudo systemctl reload openresty\n# or\n  sudo openresty -s reload'
    );
  }

  console.log(chalk.green('netget_app.conf installed and included successfully.'));
}

export default includeNetgetAppConf;
