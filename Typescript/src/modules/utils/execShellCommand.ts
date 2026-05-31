//src/modules/utils/execShellCommand.ts
import { exec } from 'child_process';

/**
 * Executes a shell command and returns the result as a promise.
 * @param cmd - The command to run, with space-separated arguments.
 * @returns A promise that resolves with the command output.
 */
export function execShellCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}