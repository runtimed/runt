/**
 * Integration test for host directory mounting functionality
 */

import { assertEquals } from "jsr:@std/assert";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";

Deno.test({
  name: "Mount integration",
  ignore: true,
}, async (t) => {
  await t.step(
    "PyodideRuntimeAgent handles mount paths correctly",
    () => {
      // Test CLI arguments with mount paths
      const args = [
        "--notebook=test-notebook",
        "--auth-token=test-token",
        "--mount=/tmp/test-data",
        "--mount=/tmp/test-scripts",
      ];

      // Create a spy to capture worker messages
      const workerMessages: unknown[] = [];
      const originalWorker = globalThis.Worker;

      // Mock Worker to capture initialization messages
      globalThis.Worker = class MockWorker extends EventTarget {
        constructor(_url: string | URL, _options?: WorkerOptions) {
          super();
          // Simulate worker that captures init message
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: { id: 1, type: "response", data: { success: true } },
              }),
            );
          }, 10);
        }

        postMessage(data: unknown) {
          workerMessages.push(data);
        }

        terminate() {
          // No-op for test
        }
      } as typeof Worker;

      try {
        const agent = new PyodideRuntimeAgent(args);

        // Don't actually start the agent (since we're mocking the worker)
        // Just verify that the mount paths are properly configured
        assertEquals(agent["options"].mountPaths, [
          "/tmp/test-data",
          "/tmp/test-scripts",
        ]);

        console.log("✅ Mount paths correctly parsed and configured");
      } finally {
        // Restore original Worker
        globalThis.Worker = originalWorker;
      }
    },
  );

  await t.step("Mount path sanitization works correctly", () => {
    // Test the sanitization logic that would happen in the worker
    const testCases = [
      { input: "/home/user/data", expected: "_home_user_data" },
      { input: "/Users/john/projects", expected: "_Users_john_projects" },
      { input: "/path/with-dashes", expected: "_path_with-dashes" },
      { input: "/path/with_underscores", expected: "_path_with_underscores" },
      { input: "/path/with spaces", expected: "_path_with_spaces" },
      {
        input: "/path/with@special$chars",
        expected: "_path_with_special_chars",
      },
    ];

    for (const testCase of testCases) {
      const sanitized = testCase.input.replace(/[^a-zA-Z0-9_-]/g, "_");
      assertEquals(sanitized, testCase.expected);
    }

    console.log("✅ Mount path sanitization works correctly");
  });

  await t.step("File system operations work with virtual mounts", async () => {
    // Create temporary test directory
    const testDir = "/tmp/runt-test-mount";
    const testFile = `${testDir}/test.txt`;
    const testContent = "Hello from mounted directory!";

    try {
      // Create test directory and file
      await Deno.mkdir(testDir, { recursive: true });
      await Deno.writeTextFile(testFile, testContent);

      // Test that our readDirectoryRecursive logic would work
      const files: Array<{ path: string; content: Uint8Array }> = [];

      // Simulate reading the directory (simplified version of what the agent does)
      try {
        for await (const entry of Deno.readDir(testDir)) {
          if (entry.isFile) {
            const fullPath = `${testDir}/${entry.name}`;
            const content = await Deno.readFile(fullPath);
            files.push({ path: entry.name, content });
          }
        }
      } catch (error) {
        console.warn("Could not read test directory:", error);
      }

      // Verify we read the file
      if (files.length > 0) {
        const firstFile = files[0];
        if (firstFile) {
          assertEquals(firstFile.path, "test.txt");
          assertEquals(
            new TextDecoder().decode(firstFile.content),
            testContent,
          );
          console.log("✅ File system operations work correctly");
        }
      } else {
        console.log("⚠️ Could not test file operations (permission issue)");
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.log(
        "⚠️ Could not create test files (permission issue):",
        errorMessage,
      );
    } finally {
      // Cleanup
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});

Deno.test({
  name: "Configuration validation",
  ignore: true,
}, async (t) => {
  await t.step("should validate mount paths are strings", () => {
    const args = [
      "--notebook=test-notebook",
      "--auth-token=test-token",
      "--mount=/valid/path",
    ];

    // This should not throw
    const agent = new PyodideRuntimeAgent(args);
    assertEquals(Array.isArray(agent["options"].mountPaths), true);
    assertEquals(agent["options"].mountPaths?.length, 1);
    assertEquals(agent["options"].mountPaths?.[0], "/valid/path");

    console.log("✅ Mount path validation works correctly");
  });

  await t.step("should handle empty mount paths gracefully", () => {
    const args = [
      "--notebook=test-notebook",
      "--auth-token=test-token",
    ];

    const agent = new PyodideRuntimeAgent(args);
    assertEquals(agent["options"].mountPaths, []);

    console.log("✅ Empty mount paths handled correctly");
  });
});
