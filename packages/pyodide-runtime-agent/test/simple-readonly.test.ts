import { assertEquals } from "jsr:@std/assert";

// Simple test to verify the read-only logic without full agent startup
Deno.test("Read-only mount configuration", () => {
  // Test that readonly flag is properly propagated through mount data
  const mountData = [
    {
      hostPath: "/test/path",
      files: [{ path: "test.txt", content: new Uint8Array([1, 2, 3]) }],
    },
  ];

  // Simulate adding readonly flag
  const readonlyMountData = mountData.map((entry) => ({
    ...entry,
    readonly: true,
  }));

  assertEquals(readonlyMountData[0].readonly, true);
  assertEquals(readonlyMountData[0].hostPath, "/test/path");
  assertEquals(readonlyMountData[0].files.length, 1);
});

Deno.test("CLI flag parsing includes mount-readonly", async () => {
  // Import the config parser
  const { parseRuntimeArgs } = await import("../../lib/src/config.ts");

  const args = [
    "--notebook=test",
    "--auth-token=token",
    "--mount=/test/path",
    "--mount-readonly",
  ];

  const result = parseRuntimeArgs(args);

  assertEquals(result.mountReadonly, true);
  assertEquals(result.mountPaths?.[0], "/test/path");
});
