import { PythonWorker } from "../src/python-worker.ts";
import { assert, assertExists, assertEquals } from "jsr:@std/assert";
import * as path from "@std/path";

let venvDir: string | undefined;
let pythonPath: string | undefined;
let setupDone = false;

async function setup() {
  if (setupDone) return;
  venvDir = await Deno.makeTempDir({ prefix: "pyworker-venv-" });
  const venvCmd = new Deno.Command("python3", {
    args: ["-m", "venv", venvDir],
    stdout: "inherit",
    stderr: "inherit",
  });
  const venvRes = await venvCmd.output();
  assert(venvRes.success, "venv creation failed");
  pythonPath = path.join(venvDir, "bin", "python");
  const pipCmd = new Deno.Command(pythonPath, {
    args: ["-m", "pip", "install", "ipykernel"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const pipRes = await pipCmd.output();
  assert(pipRes.success, "ipykernel install failed");
  setupDone = true;
}

Deno.test({
  name: "PythonWorker: specification suite",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    await setup();
    let worker: PythonWorker | undefined;
    let connPath: string | undefined;
    let tempDir: string | undefined;
    let pid: number | null = null;

    await t.step("Creates a temp directory for the conn.json", async () => {
      worker = new PythonWorker(pythonPath);
      connPath = await worker.start();
      assertExists(connPath);
      tempDir = path.dirname(connPath);
      const stat = await Deno.stat(tempDir);
      assert(stat.isDirectory, "Temp dir should exist after start");
    });

    await t.step("Manages an ipykernel lifetime (start, pid, shutdown)", async () => {
      assert(worker);
      pid = worker.getKernelPid();
      assert(typeof pid === "number" && pid > 0, "Kernel PID should be valid after start");
      await worker.shutdown();
      assertEquals(worker.getKernelPid(), null, "Kernel PID should be null after shutdown");
    });

    await t.step("Cleans up the conn.json and temp directory after shutdown", async () => {
      assert(tempDir);
      let error: unknown = null;
      try {
        await Deno.stat(tempDir);
      } catch (e) {
        error = e;
      }
      assert(error instanceof Deno.errors.NotFound, "Temp dir should be removed after shutdown");
    });

    await t.step("Gracefully handles failure to clean up conn.json directory", async () => {
      worker = new PythonWorker(pythonPath);
      connPath = await worker.start();
      tempDir = path.dirname(connPath);
      await Deno.remove(tempDir, { recursive: true });
      await worker.shutdown(); // Should not throw
    });

    await t.step("Handles when the kernel dies unexpectedly before shutdown", async () => {
      worker = new PythonWorker(pythonPath);
      await worker.start();
      pid = worker.getKernelPid();
      assert(typeof pid === "number" && pid > 0, "Kernel PID should be valid after start");
      Deno.kill(pid, "SIGKILL");
      await worker.shutdown(); // Should not throw
      assertEquals(worker.getKernelPid(), null, "Kernel PID should be null after shutdown");
    });

    await t.step("Can execute Python code and get result via JupyterKernelConnection", async () => {
      worker = new PythonWorker(pythonPath);
      await worker.start();
      const conn = await worker.getConnection();
      const { result, outputs } = await conn.execute("1+2");
      assertEquals(result.trim(), "3");
      assert(outputs.length > 0);
      await worker.shutdown();
    });

    // Teardown
    await t.step("[teardown] remove venv tempdir", async () => {
      if (venvDir) {
        await Deno.remove(venvDir, { recursive: true });
      }
    });
  },
}); 
