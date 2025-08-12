import { assertEquals, assertExists } from "jsr:@std/assert";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { type ExecutionContext } from "../../lib/src/types.ts";

Deno.test("PyodideRuntimeAgent output directory sync", async () => {
  // Create a temporary output directory
  const tempOutputDir = await Deno.makeTempDir({ prefix: "runt-output-test-" });
  
  try {
    const agent = new PyodideRuntimeAgent([
      "--notebook=test-notebook",
      "--auth-token=test-token",
      `--output-dir=${tempOutputDir}`,
    ], {
      outputDir: tempOutputDir,
    });

    // Initialize the agent
    await agent.start();

    // Create a mock execution context
    const mockContext: ExecutionContext = {
      result: () => {},
      stderr: () => {},
      abortSignal: new AbortController().signal,
    };

    // Execute Python code that creates files in /outputs
    const pythonCode = `
import os
import json

# Create a simple text file
with open('/outputs/test.txt', 'w') as f:
    f.write('Hello from Pyodide!')

# Create a JSON file
data = {'message': 'Output sync test', 'files_created': 2}
with open('/outputs/data.json', 'w') as f:
    json.dump(data, f)

# Create a file in a subdirectory
os.makedirs('/outputs/subdir', exist_ok=True)
with open('/outputs/subdir/nested.txt', 'w') as f:
    f.write('Nested file content')

print(f"Created files in /outputs")
`;

    await agent.executeCell(mockContext, pythonCode);

    // Wait a bit for sync to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check that files were synced to the host output directory
    const testFile = await Deno.readTextFile(`${tempOutputDir}/test.txt`);
    assertEquals(testFile, "Hello from Pyodide!");

    const dataFile = await Deno.readTextFile(`${tempOutputDir}/data.json`);
    const data = JSON.parse(dataFile);
    assertEquals(data.message, "Output sync test");
    assertEquals(data.files_created, 2);

    const nestedFile = await Deno.readTextFile(`${tempOutputDir}/subdir/nested.txt`);
    assertEquals(nestedFile, "Nested file content");

    // Test that subdirectory was created
    const subdirStat = await Deno.stat(`${tempOutputDir}/subdir`);
    assertExists(subdirStat);
    assertEquals(subdirStat.isDirectory, true);

    await agent.stop();
  } finally {
    // Clean up temp directory
    try {
      await Deno.remove(tempOutputDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("PyodideRuntimeAgent no output sync when outputDir not configured", async () => {
  const agent = new PyodideRuntimeAgent([
    "--notebook=test-notebook", 
    "--auth-token=test-token",
  ]);

  await agent.start();

  const mockContext: ExecutionContext = {
    result: () => {},
    stderr: () => {},
    abortSignal: new AbortController().signal,
  };

  // Execute code that would create output files
  const pythonCode = `
with open('/outputs/should_not_sync.txt', 'w') as f:
    f.write('This should not be synced')
print("Created file that should not sync")
`;

  // This should not throw an error even without outputDir configured
  await agent.executeCell(mockContext, pythonCode);

  await agent.stop();
});

Deno.test("PyodideRuntimeAgent handles empty /outputs directory gracefully", async () => {
  const tempOutputDir = await Deno.makeTempDir({ prefix: "runt-empty-output-test-" });
  
  try {
    const agent = new PyodideRuntimeAgent([
      "--notebook=test-notebook",
      "--auth-token=test-token", 
      `--output-dir=${tempOutputDir}`,
    ], {
      outputDir: tempOutputDir,
    });

    await agent.start();

    const mockContext: ExecutionContext = {
      result: () => {},
      stderr: () => {},
      abortSignal: new AbortController().signal,
    };

    // Execute code that doesn't create any output files
    const pythonCode = `
print("No files created in /outputs")
`;

    // This should complete without error
    await agent.executeCell(mockContext, pythonCode);

    await agent.stop();
  } finally {
    try {
      await Deno.remove(tempOutputDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
