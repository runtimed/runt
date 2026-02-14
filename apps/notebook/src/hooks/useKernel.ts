import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { JupyterMessage, JupyterOutput, KernelspecInfo } from "../types";

/** MIME bundle type for page payloads */
export type MimeBundle = Record<string, unknown>;

/** Page payload event from kernel introspection (? or ??) */
export interface PagePayloadEvent {
  cell_id: string;
  data: MimeBundle;
  start: number;
}

interface UseKernelOptions {
  onOutput: (cellId: string, output: JupyterOutput) => void;
  onExecutionCount: (cellId: string, count: number) => void;
  onExecutionDone: (cellId: string) => void;
  onCommMessage?: (msg: JupyterMessage) => void;
  onKernelStarted?: () => void;
  /** Called when a page payload is received (triggered by ? or ?? in IPython) */
  onPagePayload?: (cellId: string, data: MimeBundle, start: number) => void;
}

/** Info about a detected pyproject.toml */
export interface PyProjectInfo {
  path: string;
  relative_path: string;
  project_name: string | null;
  has_dependencies: boolean;
  dependency_count: number;
  has_dev_dependencies: boolean;
  requires_python: string | null;
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
onKernelStarted,
  onPagePayload,
}: UseKernelOptions) {
  const [kernelStatus, setKernelStatus] = useState<string>("not started");
  // Track whether we're in the process of auto-starting to avoid double starts
  const startingRef = useRef(false);

  // Store callbacks in refs to avoid effect re-runs causing duplicate listeners
const callbacksRef = useRef({ onOutput, onExecutionCount, onExecutionDone, onCommMessage, onKernelStarted, onPagePayload });
  callbacksRef.current = { onOutput, onExecutionCount, onExecutionDone, onCommMessage, onKernelStarted, onPagePayload };

  useEffect(() => {
    let cancelled = false;

    // Listen for page payloads from introspection (? and ??)
    const pageUnlisten = listen<PagePayloadEvent>("kernel:page_payload", (event) => {
      if (cancelled) return;
      const { onPagePayload } = callbacksRef.current;
      if (onPagePayload) {
        const { cell_id, data, start } = event.payload;
        onPagePayload(cell_id, data, start);
      }
    });

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
      pageUnlisten.then((fn) => fn());
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

  const startKernelWithConda = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting conda-managed kernel");
      await invoke("start_kernel_with_conda");
      console.log("[kernel] start_kernel_with_conda succeeded");
      setKernelStatus("idle");
      // Notify that kernel started
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_kernel_with_conda failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const startDefaultCondaKernel = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting default conda kernel");
      await invoke("start_default_conda_kernel");
      console.log("[kernel] start_default_conda_kernel succeeded");
      setKernelStatus("idle");
      // Notify that kernel started (backend may have updated metadata)
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_default_conda_kernel failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const startDefaultUvKernel = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting default uv kernel");
      await invoke("start_default_uv_kernel");
      console.log("[kernel] start_default_uv_kernel succeeded");
      setKernelStatus("idle");
      // Notify that kernel started (backend may have updated metadata)
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_default_uv_kernel failed:", e);
      setKernelStatus("error");
    }
  }, []);

  // Unified default kernel starter - backend decides uv vs conda based on availability
  const startDefaultKernel = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting default kernel (backend will choose uv or conda)");
      const envType = await invoke<string>("start_default_kernel");
      console.log(`[kernel] start_default_kernel succeeded, using ${envType}`);
      setKernelStatus("idle");
      // Notify that kernel started (backend may have updated metadata)
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_default_kernel failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const startKernelWithPyproject = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting kernel with pyproject.toml");
      await invoke("start_kernel_with_pyproject");
      console.log("[kernel] start_kernel_with_pyproject succeeded");
      setKernelStatus("idle");
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_kernel_with_pyproject failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const ensureKernelStarted = useCallback(
    async (opts?: { useUv?: boolean; useConda?: boolean; usePyproject?: boolean }) => {
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        // If useConda is explicitly requested, use conda-managed kernel
        if (opts?.useConda) {
          console.log("[kernel] useConda explicitly requested");
          await startKernelWithConda();
          return;
        }

        // If useUv is explicitly requested, use uv-managed kernel
        if (opts?.useUv) {
          console.log("[kernel] useUv explicitly requested");
          await startKernelWithUv();
          return;
        }

        // If usePyproject is explicitly requested, use pyproject.toml
        if (opts?.usePyproject) {
          console.log("[kernel] usePyproject explicitly requested");
          await startKernelWithPyproject();
          return;
        }

        // Check if notebook has conda dependencies (priority over uv)
        const condaDeps = await invoke<{ dependencies: string[] } | null>(
          "get_conda_dependencies"
        );

        if (condaDeps && condaDeps.dependencies.length > 0) {
          // Use conda-managed kernel for notebooks with conda dependencies
          console.log("[kernel] starting conda-managed kernel with deps:", condaDeps.dependencies);
          await startKernelWithConda();
          return;
        }

        // Check for pyproject.toml (auto-detect if present)
        const uvAvailable = await invoke<boolean>("check_uv_available");
        if (uvAvailable) {
          const pyprojectInfo = await invoke<PyProjectInfo | null>("detect_pyproject");
          if (pyprojectInfo?.has_dependencies) {
            console.log("[kernel] detected pyproject.toml:", pyprojectInfo.relative_path);
            await startKernelWithPyproject();
            return;
          }
        }

        // Check if notebook has uv dependencies
        const deps = await invoke<{ dependencies: string[] } | null>(
          "get_notebook_dependencies"
        );

        console.log("[kernel] deps check:", { deps, uvAvailable });

        if (deps && deps.dependencies.length > 0 && uvAvailable) {
          // Use uv-managed kernel for notebooks with dependencies
          console.log("[kernel] starting uv-managed kernel with deps:", deps.dependencies);
          await startKernelWithUv();
          return;
        }

        // Fall back to default kernel (backend decides uv vs conda)
        console.log("[kernel] falling back to default kernel");
        await startDefaultKernel();
      } finally {
        startingRef.current = false;
      }
    },
    [startKernelWithUv, startKernelWithConda, startKernelWithPyproject, startDefaultKernel]
  );

  const shutdownKernel = useCallback(async () => {
    try {
      console.log("[kernel] shutting down kernel");
      await invoke("shutdown_kernel");
      setKernelStatus("not started");
      console.log("[kernel] shutdown complete");
    } catch (e) {
      console.error("shutdown_kernel failed:", e);
    }
  }, []);

  const restartKernel = useCallback(async () => {
    console.log("[kernel] restarting kernel");
    await shutdownKernel();
    // Small delay to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));
    await ensureKernelStarted();
  }, [shutdownKernel, ensureKernelStarted]);

  return {
    kernelStatus,
    startKernel,
    startKernelWithUv,
    startKernelWithConda,
    startKernelWithPyproject,
    startDefaultKernel,
    startDefaultUvKernel,
    startDefaultCondaKernel,
    ensureKernelStarted,
    interruptKernel,
    shutdownKernel,
    restartKernel,
    listKernelspecs,
  };
}
