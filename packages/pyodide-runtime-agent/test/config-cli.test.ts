/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import {
  createRuntimeSyncPayload,
  createStorePromise,
  DEFAULT_CONFIG,
  RuntimeConfig,
} from "@runtimed/agent-core";

import {
  createBaseRuntimeConfig,
  parseBaseRuntimeArgs,
} from "../src/config-cli.ts";
import { makeInMemoryAdapter } from "npm:@livestore/adapter-web";

const REQUIRED_PARAMS = ["--notebook", "test-nb", "--auth-token", "test-token"];

function addRequiredParams(args: string[]): string[] {
  return [...REQUIRED_PARAMS, ...args];
}

async function makeBaseConfig(
  overrides: Partial<Record<string, unknown>> = {},
) {
  const baseConfig = {
    runtimeId: "test-runtime-id",
    runtimeType: "test-runtime",
    syncUrl: "wss://test.example.com",
    authToken: "test-token",
    notebookId: "test-nb",
    userId: "test-user-id",
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    },
    ...overrides,
  };

  // Create sync payload with fallback valid values for testing
  // (the actual validation happens in RuntimeConfig.validate())
  const syncPayload = createRuntimeSyncPayload({
    authToken: baseConfig.authToken || "fallback-token",
    runtimeId: baseConfig.runtimeId || "fallback-runtime-id",
    sessionId: crypto.randomUUID(),
    userId: baseConfig.userId || "fallback-user-id",
  });

  // Create store with fallback valid notebookId for testing
  const store = await createStorePromise({
    adapter: makeInMemoryAdapter({}),
    notebookId: baseConfig.notebookId || "fallback-notebook",
    syncPayload,
  });

  return {
    ...baseConfig,
    store,
  };
}

Deno.test("parseBaseRuntimeArgs: parses required CLI args", () => {
  const args = [
    "--notebook",
    "nb1",
    "--auth-token",
    "token1",
    "--runtime-id",
    "runtime1",
    "--runtime-type",
    "python",
    "--sync-url",
    "wss://example.com",
  ];

  const result = parseBaseRuntimeArgs(args);

  assertEquals(result.notebookId, "nb1");
  assertEquals(result.authToken, "token1");
  assertEquals(result.runtimeId, "runtime1");
  assertEquals(result.runtimeType, "python");
  assertEquals(result.syncUrl, "wss://example.com");
});

Deno.test("parseBaseRuntimeArgs: uses environment variable fallbacks", () => {
  const envMap: Record<string, string | undefined> = {
    NOTEBOOK_ID: "env-notebook",
    RUNT_API_KEY: "env-token",
    RUNTIME_ID: "env-runtime-id",
    RUNTIME_TYPE: "env-runtime-type",
    LIVESTORE_SYNC_URL: "wss://env.example.com",
  };

  using _getStub = stub(Deno.env, "get", (key: string) => envMap[key]);

  const result = parseBaseRuntimeArgs([]);

  assertEquals(result.notebookId, "env-notebook");
  assertEquals(result.authToken, "env-token");
  assertEquals(result.runtimeId, "env-runtime-id");
  assertEquals(result.runtimeType, "env-runtime-type");
  assertEquals(result.syncUrl, "wss://env.example.com");
});

Deno.test("parseBaseRuntimeArgs: CLI args override environment variables", () => {
  const envMap: Record<string, string | undefined> = {
    NOTEBOOK_ID: "env-notebook",
    RUNT_API_KEY: "env-token",
  };

  using _getStub = stub(Deno.env, "get", (key: string) => envMap[key]);

  const result = parseBaseRuntimeArgs([
    "--notebook",
    "cli-notebook",
    "--auth-token",
    "cli-token",
  ]);

  assertEquals(result.notebookId, "cli-notebook");
  assertEquals(result.authToken, "cli-token");
});

Deno.test("parseBaseRuntimeArgs: parses image artifact threshold", () => {
  const result = parseBaseRuntimeArgs([
    "--notebook",
    "test-nb",
    "--auth-token",
    "test-token",
    "--image-artifact-threshold",
    "8192",
  ]);

  assertEquals(result.imageArtifactThresholdBytes, 8192);
});

Deno.test("parseBaseRuntimeArgs: uses default sync URL when not provided", () => {
  const result = parseBaseRuntimeArgs([
    "--notebook",
    "test-nb",
    "--auth-token",
    "test-token",
  ]);

  assertEquals(result.syncUrl, DEFAULT_CONFIG.syncUrl);
});

Deno.test("createBaseRuntimeConfig: creates valid config with defaults", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);

  const config = createBaseRuntimeConfig(addRequiredParams([]));

  assertEquals(config.notebookId, "test-nb");
  assertEquals(config.authToken, "test-token");
  assertEquals(config.syncUrl, DEFAULT_CONFIG.syncUrl);
  assertEquals(config.runtimeType, "runtime");
  assertEquals(config.capabilities.canExecuteCode, true);
  assertEquals(config.capabilities.canExecuteSql, false);
  assertEquals(config.capabilities.canExecuteAi, false);
});

Deno.test("createBaseRuntimeConfig: generates runtime ID with defaults", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);

  const config = createBaseRuntimeConfig(addRequiredParams([]));

  assertEquals(config.runtimeId.startsWith("runtime-runtime-"), true);
});

Deno.test("createBaseRuntimeConfig: uses provided runtime ID", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);

  const config = createBaseRuntimeConfig(addRequiredParams([
    "--runtime-id",
    "custom-id",
  ]));

  assertEquals(config.runtimeId, "custom-id");
});

Deno.test("createBaseRuntimeConfig: merges with provided defaults", () => {
  using _getStub = stub(Deno.env, "get", () => undefined);

  const config = createBaseRuntimeConfig(addRequiredParams([]), {
    runtimeType: "custom-runtime",
    capabilities: {
      canExecuteCode: false,
      canExecuteSql: true,
      canExecuteAi: true,
    },
  });

  assertEquals(config.runtimeType, "custom-runtime");
  assertEquals(config.capabilities.canExecuteCode, false);
  assertEquals(config.capabilities.canExecuteSql, true);
  assertEquals(config.capabilities.canExecuteAi, true);
});

Deno.test("RuntimeConfig.validate: passes with valid config", async () => {
  const config = new RuntimeConfig(await makeBaseConfig());
  config.validate(); // Should not throw
});

Deno.test("RuntimeConfig.validate: throws for missing authToken", async () => {
  const config = new RuntimeConfig(await makeBaseConfig({ authToken: "" }));
  assertThrows(
    () => config.validate(),
    Error,
    "Missing required configuration",
  );
});

Deno.test("RuntimeConfig.validate: throws for missing notebookId", async () => {
  const config = new RuntimeConfig(await makeBaseConfig({ notebookId: "" }));
  assertThrows(
    () => config.validate(),
    Error,
    "Missing required configuration",
  );
});

Deno.test("RuntimeConfig.validate: throws for missing runtimeId", async () => {
  const config = new RuntimeConfig(await makeBaseConfig({ runtimeId: "" }));
  assertThrows(
    () => config.validate(),
    Error,
    "Missing required configuration",
  );
});

Deno.test("RuntimeConfig.validate: throws for missing runtimeType", async () => {
  const config = new RuntimeConfig(await makeBaseConfig({ runtimeType: "" }));
  assertThrows(
    () => config.validate(),
    Error,
    "Missing required configuration",
  );
});

Deno.test("RuntimeConfig: generates unique session IDs", async () => {
  const config1 = new RuntimeConfig(await makeBaseConfig());
  const config2 = new RuntimeConfig(await makeBaseConfig());

  assertEquals(config1.sessionId !== config2.sessionId, true);
  assertEquals(config1.sessionId.includes(config1.runtimeType), true);
  assertEquals(config1.sessionId.includes(config1.runtimeId), true);
});

Deno.test("RuntimeConfig: sets default image artifact threshold", async () => {
  const config = new RuntimeConfig(await makeBaseConfig());
  assertEquals(
    config.imageArtifactThresholdBytes,
    DEFAULT_CONFIG.imageArtifactThresholdBytes,
  );
});

Deno.test("RuntimeConfig: can override image artifact threshold", async () => {
  const config = new RuntimeConfig(
    await makeBaseConfig({ imageArtifactThresholdBytes: 10240 }),
  );
  assertEquals(config.imageArtifactThresholdBytes, 10240);
});
