import * as path from "@std/path";
import { Message } from "./jmp-vendor/jmp.ts";
import { createLogger } from "@runt/lib";

export type SocketProxyListener<T = unknown> = (msg: T) => void;

interface ListenerEntry<T = unknown> {
  event: string;
  listener: SocketProxyListener<T>;
  jupyterDecode: boolean;
  once: boolean;
}

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
  private stderrReader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private queue: ProxyRequest[] = [];
  private processing = false;
  private closed = false;
  private listeners: ListenerEntry[] = [];
  private receiveLoopStarted = false;
  private isHeartbeat: boolean;
  private messageCounter = 0;

  constructor(pythonPath: string, socketType: string, connect: string, scheme: string = "sha256", key: string = "") {
    this.pythonPath = pythonPath;
    this.socketType = socketType;
    this.connect = connect;
    this.scheme = scheme;
    this.key = key;
    this.isHeartbeat = /^(hb|heartbeat)$/i.test(socketType);
    this.zmqProxyPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "zmq_proxy.py"
    );
    const cmd = new Deno.Command(this.pythonPath, {
      args: [this.zmqProxyPath, "--role", this.socketType, "--connect", this.connect],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    this.proc = cmd.spawn();
    this.stdinWriter = this.proc.stdin.getWriter();
    this.stdoutReader = this.proc.stdout.getReader();
    this.stderrReader = this.proc.stderr.getReader();
    this.startStderrLogging();
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

  /**
   * Send a message. Accepts either a Message instance or raw parts (Uint8Array[]).
   */
  public async send(msg: Message | Uint8Array[]): Promise<void> {
    if (this.closed) throw new Error("SocketProxy is closed");
    if (msg instanceof Message) {
      const encoded = msg._encode(this.scheme, this.key);
      const parts: Uint8Array[] = encoded.map((part) => {
        if (part instanceof Uint8Array) return part;
        if (typeof part === "string") {
          return new TextEncoder().encode(part);
        }
        throw new Error("Unsupported message part type in send");
      });
      await this.sendRaw(parts);
    } else {
      await this.sendRaw(msg);
    }
  }

  /**
   * Register a listener for incoming messages. Only 'message' event is supported.
   * If jupyterDecode is true, decodes using Message._decode and passes Message, else passes raw parts.
   */
  public on(event: "message", listener: SocketProxyListener<Message>, jupyterDecode = true): void {
    this.listeners.push({ event, listener: listener as SocketProxyListener, jupyterDecode, once: false });
    if (!this.isHeartbeat) {
      this.startReceiveLoop();
    }
  }

  /**
   * Register a one-time listener for incoming messages.
   */
  public once(event: "message", listener: SocketProxyListener<Message>, jupyterDecode = true): void {
    this.listeners.push({ event, listener: listener as SocketProxyListener, jupyterDecode, once: true });
    if (!this.isHeartbeat) {
      this.startReceiveLoop();
    }
  }

  /**
   * Remove a listener.
   */
  public off(event: "message", listener: SocketProxyListener<Message>): void {
    this.listeners = this.listeners.filter(l => l.event !== event || l.listener !== listener);
  }

  /**
   * For heartbeat sockets, the background receive loop is disabled.
   * Use receiveRaw() directly after sendRaw() for request/response.
   */
  private startReceiveLoop() {
    if (this.receiveLoopStarted || this.isHeartbeat) return;
    this.receiveLoopStarted = true;
    (async () => {
      while (!this.closed) {
        try {
          const parts = await this.receiveRaw();
          const listeners = [...this.listeners];
          this.messageCounter++;
          for (const entry of listeners) {
            if (entry.event !== "message") continue;
            let msg: unknown = parts;
            if (entry.jupyterDecode) {
              msg = Message._decode(parts, this.scheme, this.key, {
                socketType: this.socketType,
                messageNumber: this.messageCounter,
              });
              if (!msg) continue;
            }
            (entry.listener as SocketProxyListener)(msg);
            if (entry.once) {
              this.off(entry.event, entry.listener);
            }
          }
        } catch (err) {
          if (!this.closed) {
            // Optionally log error
          }
        }
      }
    })();
  }

  /**
   * Start a background loop to read and debug log lines from zmq-proxy stderr.
   */
  private startStderrLogging() {
    const log = createLogger("socket-proxy");
    (async () => {
      let stderrBuffer = "";
      while (true) {
        try {
          const { value, done } = await this.stderrReader.read();
          if (done) break;
          if (value) stderrBuffer += this.decoder.decode(value);
          let newlineIdx;
          while ((newlineIdx = stderrBuffer.indexOf("\n")) !== -1) {
            const line = stderrBuffer.slice(0, newlineIdx);
            stderrBuffer = stderrBuffer.slice(newlineIdx + 1);
            if (line.trim()) {
              log.debug(`[zmq-proxy stderr] ${line}`);
            }
          }
        } catch (err) {
          // If the process is closed, exit loop
          break;
        }
      }
    })();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.proc.kill();
    await this.proc.status;
  }
} 
