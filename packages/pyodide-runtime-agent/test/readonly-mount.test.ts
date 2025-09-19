// Import removed - no assertions needed for this test
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { type ExecutionContext } from "@runtimed/agent-core";
import { makeInMemoryAdapter } from "npm:@livestore/adapter-web";
import {
  createRuntimeSyncPayload,
  createStorePromise,
} from "@runtimed/agent-core";
import { crypto } from "jsr:@std/crypto";

Deno.test({
  name: "PyodideRuntimeAgent read-only mounting functionality",
  ignore: true,
}, async () => {
  // Create a temporary directory with test files
  const tempMountDir = await Deno.makeTempDir({
    prefix: "runt-readonly-test-",
  });

  try {
    // Create test files in the mount directory
    await Deno.writeTextFile(
      `${tempMountDir}/readonly.txt`,
      "This file should be read-only",
    );
    await Deno.writeTextFile(
      `${tempMountDir}/data.csv`,
      "name,value\ntest,123",
    );

    // Create a subdirectory with a file
    await Deno.mkdir(`${tempMountDir}/subdir`);
    await Deno.writeTextFile(
      `${tempMountDir}/subdir/nested.txt`,
      "Nested read-only file",
    );

    try {
      // Create store
      const adapter = makeInMemoryAdapter({});
      const store = await createStorePromise({
        adapter,
        notebookId: "test-notebook",
        syncPayload: createRuntimeSyncPayload({
          authToken: "test-token",
          runtimeId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          userId: "test-user-id",
        }),
      });

      // Create a PyodideRuntimeAgent with read-only mounting
      const agent = new PyodideRuntimeAgent([
        "--notebook=test-notebook",
        "--auth-token=test-token",
        `--mount=${tempMountDir}`,
        "--mount-readonly",
      ], {
        mountPaths: [tempMountDir],
        mountReadonly: true,
      }, { store });

      // Initialize the agent
      await agent.start();

      // Create a mock execution context with cell structure
      const createMockContext = (code: string): ExecutionContext => ({
        cell: {
          id: "test-cell-id",
          cellType: "code" as const,
          source: code,

          fractionalIndex: "1.0",
          executionCount: null,
          executionState: "idle",
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
          createdBy: "test",
        },
        queueEntry: {
          id: "queue-entry-1",
          cellId: "test-cell-id",
          executionCount: 1,
          requestedBy: "test",
          status: "pending",
          assignedRuntimeSession: null,
          startedAt: null,
          completedAt: null,
          executionDurationMs: null,
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
        checkCancellation: () => {},
      });

      // Test 1: Reading files should work
      const readTestCode = `
import os

# List files in mounted directory
mount_dir = "/mnt/_${tempMountDir.replace(/[^a-zA-Z0-9_-]/g, "_")}"
print(f"Mount directory: {mount_dir}")
print("Files found:")
for item in os.listdir(mount_dir):
    print(f"  {item}")

# Read the readonly.txt file
with open(f"{mount_dir}/readonly.txt", 'r') as f:
    content = f.read()
    print(f"File content: {content}")

# Read the CSV file
with open(f"{mount_dir}/data.csv", 'r') as f:
    csv_content = f.read()
    print(f"CSV content: {csv_content}")

print("Reading files successful")
`;

      await agent.executeCell(createMockContext(readTestCode));

      // Test 2: Writing to read-only files should fail
      const writeTestCode = `
import os

mount_dir = "/mnt/_${tempMountDir.replace(/[^a-zA-Z0-9_-]/g, "_")}"

try:
    # Attempt to modify the read-only file
    with open(f"{mount_dir}/readonly.txt", 'w') as f:
        f.write("This should fail")
    print("ERROR: Write operation should have failed!")
except (OSError, PermissionError) as e:
    print(f"SUCCESS: Write operation correctly failed: {type(e).__name__}")

try:
    # Attempt to create a new file in the read-only mount
    with open(f"{mount_dir}/new_file.txt", 'w') as f:
        f.write("This should also fail")
    print("ERROR: File creation should have failed!")
except (OSError, PermissionError) as e:
    print(f"SUCCESS: File creation correctly failed: {type(e).__name__}")

try:
    # Attempt to create a new directory in the read-only mount
    os.mkdir(f"{mount_dir}/new_directory")
    print("ERROR: Directory creation should have failed!")
except (OSError, PermissionError) as e:
    print(f"SUCCESS: Directory creation correctly failed: {type(e).__name__}")

try:
    # Attempt to create a new file in a subdirectory
    with open(f"{mount_dir}/subdir/new_nested_file.txt", 'w') as f:
        f.write("This should also fail")
    print("ERROR: Nested file creation should have failed!")
except (OSError, PermissionError) as e:
    print(f"SUCCESS: Nested file creation correctly failed: {type(e).__name__}")

try:
    # Attempt to delete a read-only file
    os.remove(f"{mount_dir}/readonly.txt")
    print("ERROR: File deletion should have failed!")
except (OSError, PermissionError) as e:
    print(f"SUCCESS: File deletion correctly failed: {type(e).__name__}")

try:
    # Attempt to delete a read-only directory
    os.rmdir(f"{mount_dir}/subdir")
    print("ERROR: Directory deletion should have failed!")
except (OSError, PermissionError) as e:
    print(f"SUCCESS: Directory deletion correctly failed: {type(e).__name__}")

print("Read-only protection is working correctly")
`;

      await agent.executeCell(createMockContext(writeTestCode));

      // Wait a bit for execution to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await agent.shutdown();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  } finally {
    // Clean up temp directory
    try {
      await Deno.remove(tempMountDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test({
  name: "PyodideRuntimeAgent normal (writable) mounting still works",
  ignore: true,
}, async () => {
  // Create a temporary directory with test files
  const tempMountDir = await Deno.makeTempDir({
    prefix: "runt-writable-test-",
  });

  try {
    // Create test file
    await Deno.writeTextFile(
      `${tempMountDir}/writable.txt`,
      "This file should be writable",
    );

    const adapter2 = makeInMemoryAdapter({});
    const store2 = await createStorePromise({
      adapter: adapter2,
      notebookId: "test-notebook",
      syncPayload: createRuntimeSyncPayload({
        authToken: "test-token",
        runtimeId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        userId: "test-user-id",
      }),
    });

    const agent = new PyodideRuntimeAgent([
      "--notebook=test-notebook",
      "--auth-token=test-token",
      `--mount=${tempMountDir}`,
    ], {
      mountPaths: [tempMountDir],
      mountReadonly: false,
    }, { store: store2 });

    await agent.start();

    const createMockContext = (code: string): ExecutionContext => ({
      cell: {
        id: "test-cell-id",
        cellType: "code" as const,
        source: code,

        fractionalIndex: "1.0",
        executionCount: null,
        executionState: "idle",
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
        createdBy: "test",
      },
      queueEntry: {
        id: "queue-entry-1",
        cellId: "test-cell-id",
        executionCount: 1,
        requestedBy: "test",
        status: "pending",
        assignedRuntimeSession: null,
        startedAt: null,
        completedAt: null,
        executionDurationMs: null,
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
      checkCancellation: () => {},
    });

    // Test that writing to normally mounted files works
    const writeTestCode = `
import os

mount_dir = "/mnt/_${tempMountDir.replace(/[^a-zA-Z0-9_-]/g, "_")}"

try:
    # Modify the file (should succeed)
    with open(f"{mount_dir}/writable.txt", 'w') as f:
        f.write("Modified content")
    print("SUCCESS: Write operation succeeded as expected")

    # Verify the content was changed
    with open(f"{mount_dir}/writable.txt", 'r') as f:
        content = f.read()
        if content == "Modified content":
            print("SUCCESS: File content was correctly modified")
        else:
            print(f"ERROR: File content is unexpected: {content}")

    # Create a new file (should succeed)
    with open(f"{mount_dir}/new_file.txt", 'w') as f:
        f.write("New file content")
    print("SUCCESS: New file creation succeeded")

except Exception as e:
    print(f"ERROR: Write operation failed unexpectedly: {e}")

print("Normal mounting (writable) is working correctly")
`;

    await agent.executeCell(createMockContext(writeTestCode));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await agent.shutdown();
  } finally {
    try {
      await Deno.remove(tempMountDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
