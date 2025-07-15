import * as path from "@std/path";

let nextRequestId = 1;

type ProxyRequest =
  | { type: "write"; parts: Uint8Array[]; resolve: () => void; reject: (e: unknown) => void }
  | { type: "read"; resolve: (result: Uint8Array[]) => void; reject: (e: unknown) => void };

export class SocketProxy {
  private proc: Deno.ChildProcess;
  private pythonPath: string;
  private zmqProxyPath: string;
  private socketType: string;
  private connect: string;
  private scheme: string;
  private key: string;
  private stdinWriter: WritableStreamDefaultWriter<Uint8Array>;
  private stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private queue: ProxyRequest[] = [];
  private processing = false;
  private closed = false;

  constructor(pythonPath: string, socketType: string, connect: string, scheme: string = "sha256", key: string = "") {
    this.pythonPath = pythonPath;
    this.socketType = socketType;
    this.connect = connect;
    this.scheme = scheme;
    this.key = key;
    this.zmqProxyPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "zmq_proxy.py"
    );
    const cmd = new Deno.Command(this.pythonPath, {
      args: [this.zmqProxyPath, "--role", this.socketType, "--connect", this.connect],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    });
    this.proc = cmd.spawn();
    this.stdinWriter = this.proc.stdin.getWriter();
    this.stdoutReader = this.proc.stdout.getReader();
  }

  private encodeBase64(parts: Uint8Array[]): string[] {
    return parts.map(part => btoa(String.fromCharCode(...part)));
  }

  private decodeBase64(parts: string[]): Uint8Array[] {
    return parts.map(s => new Uint8Array([...atob(s)].map(c => c.charCodeAt(0))));
  }

  private async readResponse(): Promise<unknown[]> {
    while (true) {
      const { value, done } = await this.stdoutReader.read();
      if (done && !this.buffer) throw new Error("No response line received from proxy");
      if (value) this.buffer += this.decoder.decode(value);
      const newlineIdx = this.buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const [jsonLine, ...rest] = this.buffer.split("\n");
        this.buffer = rest.join("\n");
        if (!jsonLine) continue;
        return JSON.parse(jsonLine);
      }
      if (done) break;
    }
    throw new Error("No response line received from proxy");
  }

  private async processQueue() {
    if (this.processing || this.closed) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const req = this.queue.shift()!;
        const id = nextRequestId++;
        if (req.type === "write") {
          const payload = ["write", id, ...this.encodeBase64(req.parts)];
          await this.stdinWriter.write(new TextEncoder().encode(JSON.stringify(payload) + "\n"));
          const resp = await this.readResponse();
          if (!Array.isArray(resp) || resp[0] !== "write_complete" || resp[1] !== id) {
            req.reject(new Error(`Mismatched write response: ${JSON.stringify(resp)}`));
            continue;
          }
          req.resolve();
        } else if (req.type === "read") {
          const payload = ["read", id];
          await this.stdinWriter.write(new TextEncoder().encode(JSON.stringify(payload) + "\n"));
          const resp = await this.readResponse();
          if (!Array.isArray(resp) || resp[0] !== "read_complete" || resp[1] !== id) {
            req.reject(new Error(`Mismatched read response: ${JSON.stringify(resp)}`));
            continue;
          }
          req.resolve(this.decodeBase64(resp.slice(2) as string[]));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  public sendRaw(parts: Uint8Array[]): Promise<void> {
    if (this.closed) throw new Error("SocketProxy is closed");
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ type: "write", parts, resolve, reject });
      this.processQueue();
    });
  }

  public receiveRaw(): Promise<Uint8Array[]> {
    if (this.closed) throw new Error("SocketProxy is closed");
    return new Promise<Uint8Array[]>((resolve, reject) => {
      this.queue.push({ type: "read", resolve, reject });
      this.processQueue();
    });
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.proc.kill();
    await this.proc.status;
  }
} 
