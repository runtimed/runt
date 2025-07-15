import { createLogger } from "@runt/lib";
import * as path from "@std/path";
import { SocketProxy } from "./socket-proxy.ts";

const CHANNELS = ["shell", "iopub", "control", "stdin", "hb"] as const;
type Channel = typeof CHANNELS[number];

export class PythonWorker {
  private kernel: Deno.ChildProcess | null = null;
  private tempDir: string | null = null;
  private connPath: string | null = null;
  private pythonPath: string;
  private logger = createLogger("python-worker");
  private zmqProxies: Partial<Record<Channel, SocketProxy>> = {};

  constructor(pythonPath: string = "python3") {
    this.pythonPath = pythonPath;
  }

  async start(): Promise<string> {
    try {
      this.tempDir = await Deno.makeTempDir({ prefix: "anode-kernel" });
      this.logger.debug("Created temp dir", { tempDir: this.tempDir });
      this.connPath = path.join(this.tempDir, "conn.json");
      const args = ["-m", "ipykernel_launcher", "-f", this.connPath];
      this.logger.debug("Starting ipykernel", { python: this.pythonPath, args });
      const command = new Deno.Command(this.pythonPath, { args });
      this.kernel = command.spawn();
      this.logger.info("Kernel started", { pid: this.kernel.pid });

      await this._waitForConnJson();
      const connData = JSON.parse(await Deno.readTextFile(this.connPath!));
      await this._startZmqProxies(connData);
      return this.connPath;
    } catch (error) {
      this.logger.error("Failed to start kernel or proxies", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async _waitForConnJson(): Promise<void> {
    const maxWaitMs = 10000;
    const pollInterval = 50;
    let waited = 0;
    while (waited < maxWaitMs) {
      try {
        await Deno.stat(this.connPath!);
        return;
      } catch {
        await new Promise(r => setTimeout(r, pollInterval));
        waited += pollInterval;
      }
    }
    throw new Error("conn.json was not created by ipykernel");
  }

  private _startZmqProxies(connData: Record<string, unknown>): void {
    const key = (connData.key as string) ?? "";
    let scheme = (connData.signature_scheme as string) ?? "sha256";
    // Normalize Python's 'hmac-sha256' to 'sha256' for Node/TS crypto
    scheme = scheme.replace(/^hmac-/, "");
    for (const channel of CHANNELS) {
      let port: number;
      let socketType: string;
      switch (channel) {
        case "shell": port = connData.shell_port as number; socketType = "dealer"; break;
        case "iopub": port = connData.iopub_port as number; socketType = "sub"; break;
        case "control": port = connData.control_port as number; socketType = "dealer"; break;
        case "stdin": port = connData.stdin_port as number; socketType = "dealer"; break;
        case "hb": port = connData.hb_port as number; socketType = "req"; break;
      }
      const addr = `${connData.transport}://${connData.ip}:${port}`;
      this.zmqProxies[channel] = new SocketProxy(this.pythonPath, socketType, addr, scheme, key);
      this.logger.info("Started zmq_proxy", { channel, addr, socketType, scheme, key });
    }
  }

  async shutdown(): Promise<void> {
    // Kill zmq_proxy subprocesses
    for (const channel of CHANNELS) {
      const proxy = this.zmqProxies[channel];
      if (proxy) {
        try {
          await proxy.shutdown();
          this.logger.info("zmq_proxy shutdown", { channel });
        } catch (error) {
          this.logger.error("Error shutting down zmq_proxy", {
            channel,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        delete this.zmqProxies[channel];
      }
    }
    if (this.kernel) {
      this.logger.info("Shutting down kernel", { pid: this.kernel.pid });
      try {
        this.kernel.kill();
        await this.kernel.status;
        this.logger.info("Kernel shutdown complete", { pid: this.kernel.pid });
      } catch (error) {
        this.logger.error("Error shutting down kernel", {
          pid: this.kernel.pid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.kernel = null;
    }
    if (this.tempDir) {
      try {
        await Deno.remove(this.tempDir, { recursive: true });
        this.logger.info("Temp dir cleaned up", { tempDir: this.tempDir });
      } catch (error) {
        this.logger.error("Failed to clean up temp dir", {
          tempDir: this.tempDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.tempDir = null;
      this.connPath = null;
    }
  }

  getKernelPid(): number | null {
    return this.kernel?.pid ?? null;
  }

  getConnPath(): string | null {
    return this.connPath;
  }

  getZmqProxy(channel: Channel): SocketProxy | undefined {
    return this.zmqProxies[channel];
  }
}
