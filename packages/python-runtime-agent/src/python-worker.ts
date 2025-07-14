import { createLogger } from "@runt/lib";
import * as path from "@std/path";
import * as fs from "jsr:@std/fs";
import jmp from "@runtimed/jmp";

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

  /**
   * Returns a JupyterKernelConnection instance after the kernel is started.
   */
  async getConnection(): Promise<JupyterKernelConnection> {
    if (!this.connPath) throw new Error("Kernel not started");
    return await JupyterKernelConnection.connect(this.connPath);
  }
}

/**
 * Connects to a Jupyter kernel using conn.json and @runtimed/jmp.
 */
export class JupyterKernelConnection {
  private shellSocket: any;
  private iopubSocket: any;
  private controlSocket: any;
  private stdinSocket: any;
  private hbSocket: any;
  private config: any;
  private session: string;
  private key: string;
  private scheme: string;
  private username: string;

  private constructor(config: any, sockets: Record<string, any>) {
    this.config = config;
    this.shellSocket = sockets.shell;
    this.iopubSocket = sockets.iopub;
    this.controlSocket = sockets.control;
    this.stdinSocket = sockets.stdin;
    this.hbSocket = sockets.hb;
    this.session = crypto.randomUUID();
    this.key = config.key;
    this.scheme = config.signature_scheme.replace("hmac-", "");
    this.username = "runt";
  }

  static async connect(connPath: string): Promise<JupyterKernelConnection> {
    const configRaw = await Deno.readTextFile(connPath);
    const config = JSON.parse(configRaw);
    const mkAddr = (port: number) => `${config.transport}://${config.ip}:${port}`;
    const scheme = config.signature_scheme.replace("hmac-", "");
    const key = config.key;
    const shell = new jmp.Socket("dealer", scheme, key);
    const iopub = new jmp.Socket("sub", scheme, key);
    const control = new jmp.Socket("dealer", scheme, key);
    const stdin = new jmp.Socket("dealer", scheme, key);
    const hb = new jmp.Socket("req", scheme, key);
    shell.connect(mkAddr(config.shell_port));
    iopub.connect(mkAddr(config.iopub_port));
    iopub.subscribe("");
    control.connect(mkAddr(config.control_port));
    stdin.connect(mkAddr(config.stdin_port));
    hb.connect(mkAddr(config.hb_port));
    return new JupyterKernelConnection(config, { shell, iopub, control, stdin, hb });
  }

  /**
   * Execute Python code and return the result as a Promise.
   */
  async execute(code: string): Promise<{ result: string; outputs: unknown[] }> {
    const msg_id = crypto.randomUUID();
    const header = {
      msg_id,
      username: this.username,
      session: this.session,
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
    const msg = new jmp.Message();
    msg.header = header;
    msg.parent_header = {};
    msg.metadata = {};
    msg.content = content;
    msg.idents = [];
    // Send execute_request
    this.shellSocket.send(msg);
    // Listen for iopub messages for this msg_id
    const outputs: unknown[] = [];
    let result: string | undefined;
    for await (const msg of this.iopubSocket) {
      if (msg.parent_header?.msg_id !== msg_id) continue;
      if (msg.header.msg_type === "execute_result" || msg.header.msg_type === "display_data") {
        outputs.push(msg.content);
        if (msg.content.data && msg.content.data["text/plain"]) {
          result = msg.content.data["text/plain"];
        }
      } else if (msg.header.msg_type === "stream") {
        outputs.push(msg.content);
      } else if (msg.header.msg_type === "error") {
        outputs.push(msg.content);
        result = msg.content.ename + ": " + msg.content.evalue;
      } else if (msg.header.msg_type === "status" && msg.content.execution_state === "idle") {
        break;
      }
    }
    return { result: result ?? "", outputs };
  }
}
