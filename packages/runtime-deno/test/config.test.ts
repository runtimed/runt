import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import {
  createRuntimeConfig,
  DEFAULT_CONFIG,
  parseRuntimeArgs,
  RuntimeConfig,
} from "../src/config.ts";

const REQUIRED_PARAMS = ["--notebook", "nb", "--auth-token", "tok"];
function addRequiredParams(args: string[]): string[] {
  return [...REQUIRED_PARAMS, ...args];
}

function makeBaseConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runtimeId: "id",
    runtimeType: "type",
    syncUrl: "url",
    authToken: "token",
    notebookId: "nb",
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    },
    environmentOptions: {
      runtimePackageManager: "pip",
      runtimePythonPath: "/usr/bin/python3",
      runtimeEnvPath: "/tmp/venv",
      ...overrides,
    },
  };
}

Deno.test("parseRuntimeArgs: parses required CLI args", () => {
  const args = [
    "--notebook",
    "nb1",
    "--auth-token",
    "tok",
    "--runtime-id",
    "rid",
    "--runtime-type",
    "python",
    "--sync-url",
    "ws://foo",
    "--runtime-python-path",
    "/usr/bin/python3",
    "--runtime-env-path",
    "/tmp/venv",
    "--runtime-package-manager",
    "pipx",
    "--runtime-env-externally-managed",
  ];
  const result = parseRuntimeArgs(args);
  assertEquals(result.notebookId, "nb1");
  assertEquals(result.authToken, "tok");
  assertEquals(result.runtimeId, "rid");
  assertEquals(result.runtimeType, "python");
  assertEquals(result.syncUrl, "ws://foo");
  assert(result.environmentOptions);
  assertEquals(
    result.environmentOptions?.runtimePythonPath,
    "/usr/bin/python3",
  );
  assertEquals(result.environmentOptions?.runtimeEnvPath, "/tmp/venv");
  assertEquals(result.environmentOptions?.runtimePackageManager, "pipx");
  assertEquals(result.environmentOptions?.runtimeEnvExternallyManaged, true);
});

Deno.test("parseRuntimeArgs: uses defaults for missing environmentOptions", () => {
  const result = parseRuntimeArgs([
    "--notebook",
    "nb2",
    "--auth-token",
    "tok2",
  ]);
  assert(result.environmentOptions);
  assertEquals(result.environmentOptions?.runtimePythonPath, "python3");
  assertEquals(result.environmentOptions?.runtimePackageManager, "pip");
  assertEquals(result.environmentOptions?.runtimeEnvExternallyManaged, false);
});

Deno.test("createRuntimeConfig - sets defaults for missing options", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);
  const config = createRuntimeConfig(addRequiredParams([]));
  assertEquals(config.syncUrl, DEFAULT_CONFIG.syncUrl);
  assertEquals(config.environmentOptions?.runtimePythonPath, "python3");
  assertEquals(config.environmentOptions?.runtimePackageManager, "pip");
  assertEquals(config.environmentOptions?.runtimeEnvExternallyManaged, false);
});

Deno.test("createRuntimeConfig - deep merges environmentOptions from CLI, env, and defaults", () => {
  const envMap: Record<string, string | undefined> = {
    RUNTIME_PYTHON_PATH: "/env/python",
    RUNTIME_PACKAGE_MANAGER: "conda",
    RUNTIME_ENV_EXTERNALLY_MANAGED: "true",
  };
  using _getStub = stub(Deno.env, "get", (key: string) => envMap[key]);
  const args = addRequiredParams(["--runtime-python-path", "/cli/python"]);
  assertThrows(
    () =>
      createRuntimeConfig(args, {
        runtimeType: "python",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: false,
        },
        environmentOptions: {
          runtimePythonPath: "/default/python",
          runtimePackageManager: "pip",
          runtimeEnvExternallyManaged: false,
        },
      }),
    Error,
    "--runtime-package-manager",
  );
});

Deno.test("createRuntimeConfig - runtimeEnvExternallyManaged is true if set in CLI", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);
  const args = addRequiredParams(["--runtime-env-externally-managed"]);
  const config = createRuntimeConfig(args);
  assertEquals(config.environmentOptions?.runtimeEnvExternallyManaged, true);
});

Deno.test("createRuntimeConfig - runtimeEnvExternallyManaged is true if set in env", () => {
  const envMap: Record<string, string | undefined> = {
    RUNTIME_ENV_EXTERNALLY_MANAGED: "true",
  };
  using _getStub = stub(Deno.env, "get", (key: string) => envMap[key]);
  const config = createRuntimeConfig(addRequiredParams([]));
  assertEquals(config.environmentOptions?.runtimeEnvExternallyManaged, true);
});

Deno.test("createRuntimeConfig - runtimeEnvExternallyManaged is false if not set", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);
  const config = createRuntimeConfig(addRequiredParams([]));
  assertEquals(config.environmentOptions?.runtimeEnvExternallyManaged, false);
});

Deno.test("RuntimeConfig.validate - passes with valid environmentOptions", () => {
  const config = new RuntimeConfig(makeBaseConfig());
  config.validate();
});

Deno.test("RuntimeConfig.validate - throws for invalid manager", () => {
  assertThrows(
    () =>
      new RuntimeConfig(makeBaseConfig({ runtimePackageManager: "conda" }))
        .validate(),
    Error,
    "--runtime-package-manager",
  );
});

Deno.test("RuntimeConfig.validate - throws for empty python path", () => {
  assertThrows(
    () =>
      new RuntimeConfig(makeBaseConfig({ runtimePythonPath: "" })).validate(),
    Error,
    "--runtime-python-path",
  );
});

Deno.test("RuntimeConfig.validate - throws for empty env path", () => {
  assertThrows(
    () => new RuntimeConfig(makeBaseConfig({ runtimeEnvPath: "" })).validate(),
    Error,
    "--runtime-env-path",
  );
});
