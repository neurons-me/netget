import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { findOpenRestyBin, OPENRESTY_CANDIDATES } from './platformDetect.ts';

/**
 * Verifies if OpenResty is installed by finding a working binary.
 * @memberof module:NetGetX.OpenResty
 * @returns True if OpenResty is installed, false otherwise.
 */
export default async function verifyOpenRestyInstallation(): Promise<boolean> {
    const bin = findOpenRestyBin();
    if (!bin) {
        console.error(chalk.red('OpenResty not found.'));
        console.error(chalk.gray('Searched: ' + OPENRESTY_CANDIDATES.join(', ')));
        return false;
    }
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    const version = `${r.stdout || ''}${r.stderr || ''}`.trim();
    console.log(`OpenResty: ${chalk.blue(version)}  ${chalk.gray(bin)}`);
    return true;
}
