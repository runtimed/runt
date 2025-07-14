import { createLogger } from "@runt/lib";
import * as path from "@std/path";

export class PythonWorker {
  private kernel: Deno.ChildProcess | null = null;
  private tempDir: string | null = null;
  private connPath: string | null = null;
  private pythonPath: string;
  private logger = createLogger("python-worker");

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
      return this.connPath;
    } catch (error) {
      this.logger.error("Failed to start kernel", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
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
}
