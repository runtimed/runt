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
    
    // await t.step("Jupyter protocol: heartbeat channel integration", async () => {
    //   const worker = new PythonWorker(pythonPath);
    //   await worker.start();
    //   const hb = worker.getZmqProxy("hb");
    //   if (!hb) throw new Error("No heartbeat channel proxy");
    //   // Wait for the kernel/proxy to be ready
    //   await new Promise((r) => setTimeout(r, 300));
    //   // Heartbeat: send a ping (any bytes), expect echo
    //   const ping = new TextEncoder().encode("ping");
    //   await hb.sendRaw([ping]);
    //   const echoed = await hb.receiveRaw();
    //   // Should echo back the same message
    //   assertEquals(echoed.length, 1);
    //   assertEquals(new TextDecoder().decode(echoed[0]), "ping");
    //   await worker.shutdown();
    // });

    // await t.step("Creates a temp directory for the conn.json", async () => {
    //   worker = new PythonWorker(pythonPath);
    //   connPath = await worker.start();
    //   assertExists(connPath);
    //   tempDir = path.dirname(connPath);
    //   const stat = await Deno.stat(tempDir);
    //   assert(stat.isDirectory, "Temp dir should exist after start");
    // });

    // await t.step("Manages an ipykernel lifetime (start, pid, shutdown)", async () => {
    //   assert(worker);
    //   pid = worker.getKernelPid();
    //   assert(typeof pid === "number" && pid > 0, "Kernel PID should be valid after start");
    //   await worker.shutdown();
    //   assertEquals(worker.getKernelPid(), null, "Kernel PID should be null after shutdown");
    // });

    // await t.step("Cleans up the conn.json and temp directory after shutdown", async () => {
    //   assert(tempDir);
    //   let error: unknown = null;
    //   try {
    //     await Deno.stat(tempDir);
    //   } catch (e) {
    //     error = e;
    //   }
    //   assert(error instanceof Deno.errors.NotFound, "Temp dir should be removed after shutdown");
    // });

    // await t.step("Gracefully handles failure to clean up conn.json directory", async () => {
    //   worker = new PythonWorker(pythonPath);
    //   connPath = await worker.start();
    //   tempDir = path.dirname(connPath);
    //   await Deno.remove(tempDir, { recursive: true });
    //   await worker.shutdown(); // Should not throw
    // });

    // await t.step("Handles when the kernel dies unexpectedly before shutdown", async () => {
    //   worker = new PythonWorker(pythonPath);
    //   await worker.start();
    //   pid = worker.getKernelPid();
    //   assert(typeof pid === "number" && pid > 0, "Kernel PID should be valid after start");
    //   Deno.kill(pid, "SIGKILL");
    //   await worker.shutdown(); // Should not throw
    //   assertEquals(worker.getKernelPid(), null, "Kernel PID should be null after shutdown");
    // });

    await t.step("Jupyter protocol: execute code and receive output", async () => {
      const worker = new PythonWorker(pythonPath);
      await worker.start();
      const shell = worker.getZmqProxy("shell");
      const iopub = worker.getZmqProxy("iopub");
      if (!shell || !iopub) throw new Error("Missing shell or iopub channel");
      // Wait for the kernel/proxy to be ready
      await new Promise((r) => setTimeout(r, 300));

      // Prepare execute_request message
      const session = crypto.randomUUID();
      const msg_id = crypto.randomUUID();
      const username = "test";
      const code = 'print("Hello, World!")';
      const header = {
        msg_id,
        username,
        session,
        msg_type: "execute_request",
        version: "5.3",
      };
      const content = {
        code,
        silent: false,
        store_history: true,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: true,
      };
      const executeMsg = new (await import("../src/jmp-vendor/jmp.ts")).Message({
        header,
        parent_header: {},
        metadata: {},
        content,
        idents: [],
        buffers: [],
      });

      // Listen for output on iopub
      let output = "";
      const outputPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for output")), 5000);
        iopub.on("message", (msg) => {
          if (msg && msg.header && msg.header.msg_type === "stream" && msg.content && msg.content.text) {
            output += msg.content.text as string;
            if (output.includes("Hello, World!")) {
              clearTimeout(timeout);
              resolve(output);
            }
          }
        });
      });

      // Send execute_request
      await shell.send(executeMsg);
      const result = await outputPromise;
      assert(result.includes("Hello, World!"), "Output should contain 'Hello, World!'");
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
