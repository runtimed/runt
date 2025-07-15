import { assertEquals, assert } from "jsr:@std/assert";
import * as path from "@std/path";
import { SocketProxy } from "../src/socket-proxy.ts";

let venvDir: string | undefined;
let pythonPath: string | undefined;
let setupDone = false;

async function setup() {
  if (setupDone) return;
  venvDir = await Deno.makeTempDir({ prefix: "zmqproxy-venv-" });
  const venvCmd = new Deno.Command("python3", {
    args: ["-m", "venv", venvDir],
    stdout: "inherit",
    stderr: "inherit",
  });
  const venvRes = await venvCmd.output();
  assert(venvRes.success, "venv creation failed");
  pythonPath = path.join(venvDir, "bin", "python");
  const pipCmd = new Deno.Command(pythonPath, {
    args: ["-m", "pip", "install", "pyzmq"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const pipRes = await pipCmd.output();
  assert(pipRes.success, "pyzmq install failed");
  setupDone = true;
}

const echoScript = `
import zmq
import sys
import threading
import time
ctx = zmq.Context()
socket = ctx.socket(zmq.DEALER)
socket.bind(sys.argv[1])
def echo():
    while True:
        try:
            msg = socket.recv_multipart()
            socket.send_multipart(msg)
        except Exception:
            break
t = threading.Thread(target=echo, daemon=True)
t.start()
try:
    while True:
        time.sleep(0.1)
except KeyboardInterrupt:
    pass
`;

Deno.test({
  name: "zmq_proxy.py: integration suite",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    await setup();
    // Write echo-channel.py
    const echoPath = path.join(venvDir!, "echo-channel.py");
    await Deno.writeTextFile(echoPath, echoScript);
    // Pick a random port
    const port = 40000 + Math.floor(Math.random() * 10000);
    const addr = `tcp://127.0.0.1:${port}`;
    // Start echo-channel.py
    const echoProc = new Deno.Command(pythonPath!, {
      args: [echoPath, addr],
      stdout: "null",
      stderr: "null",
    }).spawn();
    // Wait for socket to bind
    await new Promise((r) => setTimeout(r, 500));
    // Start zmq_proxy.py using SocketProxy
    const proxy = new SocketProxy(pythonPath!, "dealer", addr);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    await t.step("basic echo", async () => {
      async function proxyRoundtrip(parts: Uint8Array[]) {
        await proxy.sendRaw(parts);
        return await proxy.receiveRaw();
      }
      const msg = [encoder.encode("hello"), encoder.encode("world")];
      const echoed = await proxyRoundtrip(msg);
      assertEquals(echoed.length, 2);
      assertEquals(decoder.decode(echoed[0]), "hello");
      assertEquals(decoder.decode(echoed[1]), "world");
    });

    await t.step("concurrent echo", async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => {
        const msg = [encoder.encode(`hello${i}`), encoder.encode(`world${i}`)];
        return (async (): Promise<string[]> => {
          await proxy.sendRaw(msg);
          const echoed = await proxy.receiveRaw();
          if (!echoed || echoed.length !== 2) throw new Error("Invalid echo response");
          return [decoder.decode(echoed[0]), decoder.decode(echoed[1])];
        })();
      });
      const results = await Promise.all(tasks);
      for (let i = 0; i < 10; ++i) {
        if (!results[i]) throw new Error(`Result for task ${i} is undefined`);
        const [a, b] = results[i] as string[];
        assertEquals(a, `hello${i}`);
        assertEquals(b, `world${i}`);
      }
    });

    // Teardown
    await proxy.shutdown();
    echoProc.kill();
    await echoProc.status;
    await Deno.remove(echoPath);
    if (!venvDir) throw new Error("venvDir was not set");
    await Deno.remove(venvDir!, { recursive: true });
  },
}); 
