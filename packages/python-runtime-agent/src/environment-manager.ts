export interface CreateEnvironmentOptions {
  pythonPath?: string;
  name?: string;
  path?: string;
  specs?: string;
}

export interface Environment {
  manager: 'pip';
  data: unknown;
}

export interface EnvironmentManager {
  createEnvironment(options?: CreateEnvironmentOptions): Promise<Environment>;
  deleteEnvironment(env: Environment): Promise<void>;
  updateEnvironment(env: Environment, specs: string): Promise<void>;
  runInEnvironment(
    env: Environment,
    command: string[],
    options?: { stdio?: 'inherit' | 'piped' | 'null' }
  ): Promise<void>;
}
