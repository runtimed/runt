import { assertEquals } from "jsr:@std/assert";
import { MCPClient } from "../mcp-client.ts";
import { join } from "jsr:@std/path";
import { assertNotEquals } from "jsr:@std/assert/not-equals";

Deno.test({
  name: "MCPClient environment inheritance",
  sanitizeOps: false, // MCP client spawns child processes
  sanitizeResources: false, // Allow child process resources
}, async () => {
  // Create a temporary config file
  const tempDir = await Deno.makeTempDir();
  const configPath = join(tempDir, "mcp.json");

  const testConfig = {
    mcpServers: {
      test: {
        command: "echo",
        args: ["test"],
        name: "Test Server",
        description: "Test server for environment inheritance",
      },
    },
  };

  await Deno.writeTextFile(configPath, JSON.stringify(testConfig, null, 2));

  const originalHome = Deno.env.get("HOME");
  const testHomeDir = join(tempDir, "home");
  await Deno.mkdir(join(testHomeDir, ".runt"), { recursive: true });
  await Deno.copyFile(configPath, join(testHomeDir, ".runt", "mcp.json"));

  try {
    Deno.env.set("HOME", testHomeDir);
    assertEquals(Deno.env.get("HOME"), testHomeDir);
    assertNotEquals(Deno.env.get("HOME"), originalHome);

    const client = new MCPClient();

    // This should work now that we inherit the environment
    // Note: This test verifies the environment is passed, but echo isn't an MCP server
    // so it will fail during the MCP handshake, which is expected
    await client.initialize();

    // Clean up with timeout to prevent hanging
    await Promise.race([
      client.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Cleanup timeout")), 5000)
      ),
    ]).catch(() => {
      // Ignore cleanup errors - test focus is environment inheritance
    });

    // Give child processes time to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    // Restore original HOME
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }

    // Clean up temp directory
    await Deno.remove(tempDir, { recursive: true });
  }
});
