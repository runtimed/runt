import { PipEnvironmentManager } from '../src/pip-environment-manager.ts';

Deno.test('createEnvironment: no envPath (uses temp folder)', async () => {
  const envManager = new PipEnvironmentManager();
  const env = await envManager.createEnvironment();
  if (typeof env.data !== 'string' || !env.data.startsWith('/')) {
    throw new Error('Did not use a temp folder for environment');
  }
  await envManager.deleteEnvironment(env);
});

Deno.test('createEnvironment: with envPath', async () => {
  const envManager = new PipEnvironmentManager();
  const customPath = await Deno.makeTempDir();
  const env = await envManager.createEnvironment({ path: customPath });
  if (env.data !== customPath) {
    throw new Error('Did not use the provided envPath');
  }
  await envManager.deleteEnvironment(env);
});

Deno.test('createEnvironment: with spec (requirements)', async () => {
  const envManager = new PipEnvironmentManager();
  const env = await envManager.createEnvironment({ specs: 'requests' });
  // Check that requests is importable
  await envManager.runInEnvironment(env, ['python', '-c', 'import requests']);
  await envManager.deleteEnvironment(env);
});

Deno.test('createEnvironment: without spec (no requirements)', async () => {
  const envManager = new PipEnvironmentManager();
  const env = await envManager.createEnvironment();
  // Should not throw, but requests should not be importable
  let errored = false;
  try {
    await envManager.runInEnvironment(env, ['python', '-c', 'import requests']);
  } catch {
    errored = true;
  }
  if (!errored) {
    throw new Error('requests should not be importable without spec');
  }
  await envManager.deleteEnvironment(env);
});

Deno.test('createEnvironment: errors if pythonPath is wrong', async () => {
  const envManager = new PipEnvironmentManager();
  let errored = false;
  try {
    await envManager.createEnvironment({
      pythonPath: '/tmp/not/a/real/python',
    });
  } catch {
    errored = true;
  }
  if (!errored) {
    throw new Error('Did not error on invalid pythonPath');
  }
});

Deno.test(
  'updateEnvironment: can update multiple times in same environment',
  async () => {
    const envManager = new PipEnvironmentManager();
    const env = await envManager.createEnvironment();
    // First update: install requests
    await envManager.updateEnvironment(env, 'requests');
    await envManager.runInEnvironment(env, ['python', '-c', 'import requests']);
    // Second update: install numpy
    await envManager.updateEnvironment(env, 'numpy');
    await envManager.runInEnvironment(env, ['python', '-c', 'import numpy']);
    await envManager.deleteEnvironment(env);
  }
);

Deno.test('deleteEnvironment: removes environment', async () => {
  const envManager = new PipEnvironmentManager();
  const env = await envManager.createEnvironment();
  const envPath = env.data as string;
  await envManager.deleteEnvironment(env);
  let errored = false;
  try {
    await Deno.stat(envPath);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      errored = true;
    }
  }
  if (!errored) {
    throw new Error('Environment directory still exists after delete');
  }
});

Deno.test(
  'runInEnvironment: can run python and CLI from pip package',
  async () => {
    const envManager = new PipEnvironmentManager();
    const env = await envManager.createEnvironment({ specs: 'black' });
    // Run python
    await envManager.runInEnvironment(env, ['python', '-c', "print('hello')"]);
    // Run black CLI (should print help)
    let errored = false;
    try {
      await envManager.runInEnvironment(env, ['black', '--help']);
    } catch {
      errored = true;
    }
    if (errored) {
      throw new Error('Failed to run black CLI after installing with pip');
    }
    await envManager.deleteEnvironment(env);
  }
);

Deno.test(
  'createEnvironment: relative envPath works after cwd restore',
  async () => {
    const envManager = new PipEnvironmentManager();
    const origCwd = Deno.cwd();
    const tempDir = await Deno.makeTempDir();
    try {
      Deno.chdir(tempDir);
      const relPath = 'relativePath/here';
      const env = await envManager.createEnvironment({ path: relPath });
      // Restore cwd
      Deno.chdir(origCwd);
      // After changing the working directory, runInEnvironment
      // needs to still succeed. This only happens if the environment
      // uses absolute paths
      await envManager.runInEnvironment(env, [
        'python',
        '-c',
        "print('Successfully handled relative paths')",
      ]);
      await envManager.deleteEnvironment(env);
    } finally {
      try {
        await Deno.remove(tempDir);
      } catch {
        // Ignore errors, continue cleanup
      }
      Deno.chdir(origCwd);
    }
  }
);

Deno.test(
  'getEnvironmentPath: returns correct path for pip environment',
  async () => {
    const envManager = new PipEnvironmentManager();
    const env = await envManager.createEnvironment();
    const path = envManager.getEnvironmentPath(env);
    if (path !== env.data) {
      throw new Error('getEnvironmentPath did not return the correct path');
    }
    await envManager.deleteEnvironment(env);
  }
);

Deno.test('getEnvironmentPath: throws for invalid manager', () => {
  const envManager = new PipEnvironmentManager();
  const fakeEnv = { manager: 'conda', data: '/tmp/fake' } as any;
  let errored = false;
  try {
    envManager.getEnvironmentPath(fakeEnv);
  } catch {
    errored = true;
  }
  if (!errored) {
    throw new Error('getEnvironmentPath did not throw for invalid manager');
  }
});
