import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { handlePermission } from '../../utils/handlePermissions.ts';
import { getNetgetAppConfContent } from './setNginxConfigRoutes.ts';
import { detectOpenRestyLayout, findOpenRestyBin, validateOpenRestyConfig } from './platformDetect.ts';

async function writeFileWithFallback(destPath: string, content: string, task: string): Promise<void> {
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf8');
    return;
  } catch (error: any) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
  }

  const tmpPath = path.join('/tmp', path.basename(destPath));
  fs.writeFileSync(tmpPath, content, 'utf8');
  const cmd = `sh -c 'mkdir -p "${path.dirname(destPath)}" && cp -f "${tmpPath}" "${destPath}"'`;
  await handlePermission(
    task,
    cmd,
    `Run manually:\nsudo ${cmd}`
  );
}

async function copyLuaWithFallback(srcLuaDir: string, luaTargetDir: string): Promise<void> {
  if (!fs.existsSync(srcLuaDir)) {
    console.log(chalk.yellow(`Lua source directory not found: ${srcLuaDir}`));
    return;
  }

  try {
    fs.mkdirSync(luaTargetDir, { recursive: true });
    fs.cpSync(srcLuaDir, luaTargetDir, { recursive: true, force: true });
    console.log(chalk.green(`Lua scripts copied to ${luaTargetDir}.`));
    return;
  } catch (error: any) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
  }

  const cmd = `sh -c 'mkdir -p "${luaTargetDir}" && cp -R "${srcLuaDir}/." "${luaTargetDir}/"'`;
  await handlePermission(
    'Install/Update Lua scripts into OpenResty prefix',
    cmd,
    `Run manually:\nsudo ${cmd}`
  );
  console.log(chalk.green(`Lua scripts copied to ${luaTargetDir}.`));
}

/**
 * Installs netget_app.conf into the detected OpenResty conf.d directory.
 */
async function includeNetgetAppConf(): Promise<void> {
  const layout = detectOpenRestyLayout();
  if (!layout.isSupported) {
    console.log(chalk.yellow('OpenResty automatic configuration is not supported on this platform.'));
    if (layout.installNote) console.log(chalk.gray(layout.installNote));
    return;
  }

  const destConf = path.join(layout.confDDir, 'netget_app.conf');
  const sourceDir = path.dirname(new URL(import.meta.url).pathname);

  console.log(chalk.gray(`OpenResty layout: ${layout.layoutKey}`));
  console.log(chalk.gray(`nginx.conf: ${layout.configFilePath}`));
  console.log(chalk.gray(`conf.d: ${layout.confDDir}`));

  await writeFileWithFallback(
    destConf,
    getNetgetAppConfContent(),
    `write netget_app.conf at ${destConf}`
  );
  console.log(chalk.green(`netget_app.conf installed at ${destConf}.`));

  const srcLuaDir = path.join(sourceDir, 'lua');
  await copyLuaWithFallback(srcLuaDir, layout.luaDir);

  try {
    const current = fs.readFileSync(layout.configFilePath, 'utf8');
    if (!current.includes(`include     ${layout.confDDir}/*.conf;`) && !current.includes(`include ${layout.confDDir}/*.conf;`)) {
      console.log(chalk.yellow(`nginx.conf does not appear to include ${layout.confDDir}/*.conf.`));
      console.log(chalk.gray('Run the Main Server setup/reset flow to regenerate nginx.conf with the correct include.'));
    }
    if (!current.includes('lua_package_path')) {
      console.log(chalk.yellow('lua_package_path not detected in nginx.conf.'));
      console.log(chalk.gray(`Expected: lua_package_path "${layout.luaPackagePath}";`));
    }
  } catch (error: any) {
    console.log(chalk.yellow(`Could not verify nginx.conf: ${error.message}`));
  }

  const { reload } = await inquirer.prompt<{ reload: boolean }>([
    { type: 'confirm', name: 'reload', message: 'Validate configuration and reload OpenResty now?', default: true }
  ]);

  if (reload) {
    const bin = findOpenRestyBin();
    if (!bin) {
      console.log(chalk.yellow('OpenResty binary not found. Install OpenResty before reloading.'));
      return;
    }

    const validation = validateOpenRestyConfig(bin);
    if (!validation.ok) {
      console.log(chalk.yellow('OpenResty config validation did not pass without sudo:'));
      console.log(chalk.gray(validation.output || '(no output)'));
      console.log(chalk.gray(`Manual validation: sudo ${bin} -t`));
    } else {
      console.log(chalk.green('OpenResty configuration is valid.'));
    }

    const reloadCmd = process.platform === 'linux'
      ? `sh -c 'systemctl reload openresty || "${bin}" -s reload'`
      : `sh -c '"${bin}" -s reload'`;

    await handlePermission(
      'reload OpenResty',
      reloadCmd,
      `Run manually:\nsudo ${bin} -t\nsudo ${bin} -s reload`
    );
  }

  console.log(chalk.green('netget_app.conf installed successfully.'));
}

export default includeNetgetAppConf;
