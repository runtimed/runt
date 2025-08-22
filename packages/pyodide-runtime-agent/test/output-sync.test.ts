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

    // Create a mock execution context
    const mockContext: ExecutionContext = {
      cell: {
        id: "test-cell",
        cellType: "code",
        source: pythonCode,
        fractionalIndex: "a0",
        executionCount: null,
        executionState: "queued",
        assignedRuntimeSession: null,
        lastExecutionDurationMs: null,
        sqlConnectionId: null,
        sqlResultVariable: null,
        aiProvider: null,
        aiModel: null,
        aiSettings: null,
        sourceVisible: true,
        outputVisible: true,
        aiContextVisible: true,
        createdBy: "test"
      },
      queueEntry: {
        id: "queue-entry-1",
        cellId: "test-cell",
        executionCount: 1,
        requestedBy: "test-runtime",
        status: "pending",
        assignedRuntimeSession: null,
        startedAt: null,
        completedAt: null,
        executionDurationMs: null
      },
      store: agent.store,
      sessionId: agent.config.sessionId,
      runtimeId: agent.config.runtimeId,
      result: async () => {},
      stderr: () => {},
      stdout: () => {},
      display: async () => {},
      updateDisplay: async () => {},
      error: () => {},
      clear: () => {},
      appendTerminal: () => {},
      markdown: () => "",
      appendMarkdown: () => {},
      abortSignal: new AbortController().signal,
      checkCancellation: () => {}
    };

    await agent.executeCell(mockContext);

    // Wait a bit for sync to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check that files were synced to the host output directory
    const testFile = await Deno.readTextFile(`${tempOutputDir}/test.txt`);
    assertEquals(testFile, "Hello from Pyodide!");

    const dataFile = await Deno.readTextFile(`${tempOutputDir}/data.json`);
    const data = JSON.parse(dataFile);
    assertEquals(data.message, "Output sync test");
    assertEquals(data.files_created, 2);

    const nestedFile = await Deno.readTextFile(
      `${tempOutputDir}/subdir/nested.txt`,
    );
    assertEquals(nestedFile, "Nested file content");

    // Test that subdirectory was created
    const subdirStat = await Deno.stat(`${tempOutputDir}/subdir`);
    assertExists(subdirStat);
    assertEquals(subdirStat.isDirectory, true);

    // Note: PyodideRuntimeAgent doesn't have a stop() method, cleanup happens automatically
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

  const pythonCode = `
with open('/outputs/should_not_sync.txt', 'w') as f:
    f.write('This should not be synced')
print("Created file that should not sync")
`;

  const mockContext: ExecutionContext = {
    cell: {
      id: "test-cell-2",
      cellType: "code",
      source: pythonCode,
      fractionalIndex: "a0",
      executionCount: null,
      executionState: "queued",
      assignedRuntimeSession: null,
      lastExecutionDurationMs: null,
      sqlConnectionId: null,
      sqlResultVariable: null,
      aiProvider: null,
      aiModel: null,
      aiSettings: null,
      sourceVisible: true,
      outputVisible: true,
      aiContextVisible: true,
      createdBy: "test"
    },
    queueEntry: {
      id: "queue-entry-2",
      cellId: "test-cell-2",
      executionCount: 1,
      requestedBy: "test-runtime",
      status: "pending",
      assignedRuntimeSession: null,
      startedAt: null,
      completedAt: null,
      executionDurationMs: null
    },
    store: agent.store,
    sessionId: agent.config.sessionId,
    runtimeId: agent.config.runtimeId,
    result: async () => {},
    stderr: () => {},
    stdout: () => {},
    display: async () => {},
    updateDisplay: async () => {},
    error: () => {},
    clear: () => {},
    appendTerminal: () => {},
    markdown: () => "",
    appendMarkdown: () => {},
    abortSignal: new AbortController().signal,
    checkCancellation: () => {}
  };

  // This should not throw an error even without outputDir configured
  await agent.executeCell(mockContext);

  // Note: PyodideRuntimeAgent doesn't have a stop() method, cleanup happens automatically
});

Deno.test("PyodideRuntimeAgent handles empty /outputs directory gracefully", async () => {
  const tempOutputDir = await Deno.makeTempDir({
    prefix: "runt-empty-output-test-",
  });

  try {
    const agent = new PyodideRuntimeAgent([
      "--notebook=test-notebook",
      "--auth-token=test-token",
      `--output-dir=${tempOutputDir}`,
    ], {
      outputDir: tempOutputDir,
    });

    await agent.start();

    const pythonCode = `
print("No files created in /outputs")
`;

    const mockContext: ExecutionContext = {
      cell: {
        id: "test-cell-3",
        cellType: "code",
        source: pythonCode,
        fractionalIndex: "a0",
        executionCount: null,
        executionState: "queued",
        assignedRuntimeSession: null,
        lastExecutionDurationMs: null,
        sqlConnectionId: null,
        sqlResultVariable: null,
        aiProvider: null,
        aiModel: null,
        aiSettings: null,
        sourceVisible: true,
        outputVisible: true,
        aiContextVisible: true,
        createdBy: "test"
      },
      queueEntry: {
        id: "queue-entry-3",
        cellId: "test-cell-3",
        executionCount: 1,
        requestedBy: "test-runtime",
        status: "pending",
        assignedRuntimeSession: null,
        startedAt: null,
        completedAt: null,
        executionDurationMs: null
      },
      store: agent.store,
      sessionId: agent.config.sessionId,
      runtimeId: agent.config.runtimeId,
      result: async () => {},
      stderr: () => {},
      stdout: () => {},
      display: async () => {},
      updateDisplay: async () => {},
      error: () => {},
      clear: () => {},
      appendTerminal: () => {},
      markdown: () => "",
      appendMarkdown: () => {},
      abortSignal: new AbortController().signal,
      checkCancellation: () => {}
    };

    // This should complete without error
    await agent.executeCell(mockContext);

    // Note: PyodideRuntimeAgent doesn't have a stop() method, cleanup happens automatically
  } finally {
    try {
      await Deno.remove(tempOutputDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
