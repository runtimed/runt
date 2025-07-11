import {
  EnvironmentManager,
  CreateEnvironmentOptions,
  Environment,
} from './environment-manager.ts';
import { join } from 'jsr:@std/path/join';
import { isAbsolute } from 'jsr:@std/path/is-absolute';

export type { Environment } from './environment-manager.ts';

function getEnvironmentBin(envPath: string, bin: string): string {
  const binDir = Deno.build.os === 'windows' ? 'Scripts' : 'bin';
  const binName =
    bin + (Deno.build.os === 'windows' && !bin.endsWith('.exe') ? '.exe' : '');
  return join(envPath, binDir, binName);
}

export class PipEnvironmentManager implements EnvironmentManager {
  async createEnvironment(
    options?: CreateEnvironmentOptions
  ): Promise<Environment> {
    const pythonPath = options?.pythonPath || 'python3';
    let envPath: string;
    if (options?.path) {
      envPath = isAbsolute(options.path)
        ? options.path
        : join(Deno.cwd(), options.path);
      try {
        await Deno.mkdir(envPath, { recursive: true });
      } catch (err) {
        if (!(err instanceof Deno.errors.AlreadyExists)) {
          throw err;
        }
      }
    } else {
      envPath = await Deno.makeTempDir();
    }
    const venvCmd = new Deno.Command(pythonPath, {
      args: ['-m', 'venv', envPath],
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const venvStatus = await venvCmd.spawn().status;
    if (!venvStatus.success) {
      throw new Error('Failed to create venv');
    }
    const env: Environment = { manager: 'pip', data: envPath };
    if (options?.specs) {
      await this.updateEnvironment(env, options.specs);
    }
    return env;
  }

  async deleteEnvironment(env: Environment): Promise<void> {
    const envPath = this.getEnvironmentPath(env);
    try {
      await Deno.remove(envPath, { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
      }
    }
  }

  async updateEnvironment(env: Environment, specs: string): Promise<void> {
    const envPath = this.getEnvironmentPath(env);
    const reqPath = await Deno.makeTempFile({ dir: envPath, suffix: '.txt' });
    try {
      await Deno.writeTextFile(reqPath, specs);
      await this.runInEnvironment(env, [
        'python',
        '-m',
        'pip',
        'install',
        '-r',
        reqPath,
      ]);
    } finally {
      await Deno.remove(reqPath);
    }
  }

  async runInEnvironment(
    env: Environment,
    command: string[],
    options?: { stdio?: 'inherit' | 'piped' | 'null' }
  ): Promise<void> {
    const envPath = this.getEnvironmentPath(env);
    if (!command[0]) {
      throw new Error('No command specified to run in environment');
    }
    const binPath = getEnvironmentBin(envPath, command[0]);
    const cmd = new Deno.Command(binPath, {
      args: command.slice(1),
      stdout: options?.stdio ?? 'inherit',
      stderr: options?.stdio ?? 'inherit',
    });
    const status = await cmd.spawn().status;
    if (!status.success) {
      throw new Error(`Command failed: ${command.join(' ')}`);
    }
  }

  getEnvironmentPath(env: Environment): string {
    if (env.manager !== 'pip') throw new Error('Invalid environment manager');
    return env.data as string;
  }
}
