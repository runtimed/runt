import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { JupyterMessage, JupyterOutput, KernelspecInfo } from "../types";

interface UseKernelOptions {
  onOutput: (cellId: string, output: JupyterOutput) => void;
  onExecutionCount: (cellId: string, count: number) => void;
  onExecutionDone: (cellId: string) => void;
  onCommMessage?: (msg: JupyterMessage) => void;
}

/**
 * Decode base64-encoded buffer strings into ArrayBuffers.
 * The Rust side serializes Vec<Bytes> as base64 strings.
 */
function decodeBuffers(buffers?: unknown[]): ArrayBuffer[] {
  if (!buffers || buffers.length === 0) return [];
  return buffers.map((b) => {
    if (typeof b === "string") {
      const binary = atob(b);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    return new ArrayBuffer(0);
  });
}

export function useKernel({
  onOutput,
  onExecutionCount,
  onExecutionDone,
  onCommMessage,
}: UseKernelOptions) {
  const [kernelStatus, setKernelStatus] = useState<string>("not started");
  // Track whether we're in the process of auto-starting to avoid double starts
  const startingRef = useRef(false);

  // Store callbacks in refs to avoid effect re-runs causing duplicate listeners
  const callbacksRef = useRef({ onOutput, onExecutionCount, onExecutionDone, onCommMessage });
  callbacksRef.current = { onOutput, onExecutionCount, onExecutionDone, onCommMessage };

  useEffect(() => {
    let cancelled = false;

    const unlisten = listen<JupyterMessage>("kernel:iopub", (event) => {
      if (cancelled) return;

      const { onOutput, onExecutionCount, onExecutionDone, onCommMessage } = callbacksRef.current;
      const msg = event.payload;
      const msgType = msg.header.msg_type;
      const cellId = msg.cell_id;

      // Route comm messages to the widget store
      if (
        msgType === "comm_open" ||
        msgType === "comm_msg" ||
        msgType === "comm_close"
      ) {
        if (onCommMessage) {
          // Decode base64 buffers before passing to widget store
          const decoded = {
            ...msg,
            buffers: decodeBuffers(msg.buffers),
          };
          onCommMessage(decoded as JupyterMessage);
        }
        return;
      }

      if (msgType === "status") {
        const state = (msg.content as { execution_state: string })
          .execution_state;
        setKernelStatus(state);
        if (state === "idle" && cellId) {
          onExecutionDone(cellId);
        }
        return;
      }

      if (!cellId) return;

      if (msgType === "execute_input") {
        const content = msg.content as { execution_count: number };
        onExecutionCount(cellId, content.execution_count);
        return;
      }

      if (msgType === "stream") {
        const content = msg.content as { name: string; text: string };
        onOutput(cellId, {
          output_type: "stream",
          name: content.name as "stdout" | "stderr",
          text: content.text,
        });
      } else if (msgType === "display_data") {
        const content = msg.content as {
          data: Record<string, unknown>;
          metadata: Record<string, unknown>;
        };
        onOutput(cellId, {
          output_type: "display_data",
          data: content.data,
          metadata: content.metadata,
        });
      } else if (msgType === "execute_result") {
        const content = msg.content as {
          data: Record<string, unknown>;
          metadata: Record<string, unknown>;
          execution_count: number;
        };
        onOutput(cellId, {
          output_type: "execute_result",
          data: content.data,
          metadata: content.metadata,
          execution_count: content.execution_count,
        });
        onExecutionCount(cellId, content.execution_count);
      } else if (msgType === "error") {
        const content = msg.content as {
          ename: string;
          evalue: string;
          traceback: string[];
        };
        onOutput(cellId, {
          output_type: "error",
          ename: content.ename,
          evalue: content.evalue,
          traceback: content.traceback,
        });
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []); // Empty deps - callbacks accessed via ref

  const startKernel = useCallback(async (name: string) => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting kernel:", name);
      await invoke("start_kernel", { kernelspecName: name });
      console.log("[kernel] start_kernel succeeded, setting status to idle");
      // The Rust side confirmed the kernel is alive (got kernel_info_reply)
      setKernelStatus("idle");
    } catch (e) {
      console.error("start_kernel failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const interruptKernel = useCallback(async () => {
    try {
      await invoke("interrupt_kernel");
    } catch (e) {
      console.error("interrupt_kernel failed:", e);
    }
  }, []);

  const listKernelspecs = useCallback(async (): Promise<KernelspecInfo[]> => {
    try {
      return await invoke<KernelspecInfo[]>("list_kernelspecs");
    } catch (e) {
      console.error("list_kernelspecs failed:", e);
      return [];
    }
  }, []);

  const startKernelWithUv = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting uv-managed kernel");
      await invoke("start_kernel_with_uv");
      console.log("[kernel] start_kernel_with_uv succeeded");
      setKernelStatus("idle");
    } catch (e) {
      console.error("start_kernel_with_uv failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const ensureKernelStarted = useCallback(
    async (opts?: { useUv?: boolean }) => {
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        // If useUv is explicitly requested, use uv-managed kernel
        if (opts?.useUv) {
          console.log("[kernel] useUv explicitly requested");
          await startKernelWithUv();
          return;
        }

        // Check if notebook has uv dependencies
        const deps = await invoke<{ dependencies: string[] } | null>(
          "get_notebook_dependencies"
        );
        const uvAvailable = await invoke<boolean>("check_uv_available");

        console.log("[kernel] deps check:", { deps, uvAvailable });

        if (deps && deps.dependencies.length > 0 && uvAvailable) {
          // Use uv-managed kernel for notebooks with dependencies
          console.log("[kernel] starting uv-managed kernel with deps:", deps.dependencies);
          await startKernelWithUv();
          return;
        }

        // Fall back to system kernelspec
        console.log("[kernel] falling back to system kernelspec");
        const preferred = await invoke<string | null>(
          "get_preferred_kernelspec"
        );
        if (preferred) {
          console.log("[kernel] using preferred kernelspec:", preferred);
          await startKernel(preferred);
          return;
        }
        // Fall back to first available kernelspec
        const specs = await listKernelspecs();
        if (specs.length > 0) {
          console.log("[kernel] using first available kernelspec:", specs[0].name);
          await startKernel(specs[0].name);
        }
      } finally {
        startingRef.current = false;
      }
    },
    [startKernel, startKernelWithUv, listKernelspecs]
  );

  return {
    kernelStatus,
    startKernel,
    startKernelWithUv,
    ensureKernelStarted,
    interruptKernel,
    listKernelspecs,
  };
}
