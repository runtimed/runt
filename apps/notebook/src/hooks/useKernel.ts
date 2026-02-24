import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
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
  onOutput: (
    cellId: string,
    output: JupyterOutput,
    meta?: { parentMsgId?: string },
  ) => void;
  onExecutionCount: (cellId: string, count: number) => void;
  onExecutionDone: (cellId: string) => void;
  onCommMessage?: (msg: JupyterMessage) => void;
  onKernelStarted?: () => void;
  /** Called when a page payload is received (triggered by ? or ?? in IPython) */
  onPagePayload?: (cellId: string, data: MimeBundle, start: number) => void;
  /** Called when an update_display_data message is received */
  onUpdateDisplayData?: (
    displayId: string,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) => void;
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
  has_venv: boolean;
}

/** Info about a detected deno.json/deno.jsonc */
export interface DenoConfigInfo {
  path: string;
  relative_path: string;
  name: string | null;
  has_imports: boolean;
  has_tasks: boolean;
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
  onUpdateDisplayData,
}: UseKernelOptions) {
  const [kernelStatus, setKernelStatus] = useState<string>("not started");
  // Error message from kernel launch failure
  const [kernelErrorMessage, setKernelErrorMessage] = useState<string | null>(
    null,
  );
  // Environment source from backend (e.g. "uv:inline", "uv:pyproject", "conda:prewarmed")
  const [envSource, setEnvSource] = useState<string | null>(null);
  // Track whether we're in the process of auto-starting to avoid double starts
  const startingRef = useRef(false);

  // Store callbacks in refs to avoid effect re-runs causing duplicate listeners
  const callbacksRef = useRef({
    onOutput,
    onExecutionCount,
    onExecutionDone,
    onCommMessage,
    onKernelStarted,
    onPagePayload,
    onUpdateDisplayData,
  });
  callbacksRef.current = {
    onOutput,
    onExecutionCount,
    onExecutionDone,
    onCommMessage,
    onKernelStarted,
    onPagePayload,
    onUpdateDisplayData,
  };

  useEffect(() => {
    let cancelled = false;

    // Query initial kernel lifecycle state to handle race condition
    // where backend may have already started launching before we set up listeners
    invoke<string>("get_kernel_lifecycle").then((state) => {
      if (cancelled) return;
      if (state === "launching") {
        setKernelStatus("starting");
      } else if (state === "running") {
        setKernelStatus("idle");
      }
    });

    // Listen for page payloads from introspection (? and ??)
    const pageUnlisten = listen<PagePayloadEvent>(
      "kernel:page_payload",
      (event) => {
        if (cancelled) return;
        const { onPagePayload } = callbacksRef.current;
        if (onPagePayload) {
          const { cell_id, data, start } = event.payload;
          onPagePayload(cell_id, data, start);
        }
      },
    );

    // Listen for kernel lifecycle events (auto-launch starting/ready/error)
    const lifecycleUnlisten = listen<{
      state: string;
      runtime: string;
      env_source?: string;
      error_message?: string;
    }>("kernel:lifecycle", (event) => {
      if (cancelled) return;
      if (event.payload.state === "launching") {
        setKernelStatus("starting");
        setKernelErrorMessage(null);
      } else if (event.payload.state === "ready" && event.payload.env_source) {
        setEnvSource(event.payload.env_source);
        setKernelErrorMessage(null);
      } else if (event.payload.state === "error") {
        setKernelStatus("error");
        setKernelErrorMessage(event.payload.error_message ?? null);
      } else if (event.payload.state === "not started") {
        setKernelStatus("not started");
        setEnvSource(null);
        setKernelErrorMessage(null);
        startingRef.current = false;
      }
    });

    const unlisten = listen<JupyterMessage>("kernel:iopub", (event) => {
      if (cancelled) return;

      const { onOutput, onExecutionCount, onExecutionDone, onCommMessage } =
        callbacksRef.current;
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

      if (msgType === "update_display_data") {
        const { onUpdateDisplayData } = callbacksRef.current;
        if (onUpdateDisplayData) {
          const content = msg.content as {
            data: Record<string, unknown>;
            metadata: Record<string, unknown>;
            transient?: { display_id?: string };
          };
          const displayId = content.transient?.display_id;
          if (displayId) {
            onUpdateDisplayData(displayId, content.data, content.metadata);
          }
        }
        return;
      }

      if (!cellId) return;

      if (msgType === "execute_input") {
        const content = msg.content as { execution_count: number };
        onExecutionCount(cellId, content.execution_count);
        // Sync execution count to Automerge for cross-window sync
        invoke("sync_execution_count", {
          cellId,
          count: content.execution_count,
        }).catch(() => {}); // Fire-and-forget
        return;
      }

      if (msgType === "stream") {
        const content = msg.content as { name: string; text: string };
        const output = {
          output_type: "stream" as const,
          name: content.name as "stdout" | "stderr",
          text: content.text,
        };
        onOutput(cellId, output, { parentMsgId: msg.parent_header?.msg_id });
        // Sync output to Automerge for cross-window sync
        invoke("sync_append_output", {
          cellId,
          outputJson: JSON.stringify(output),
        }).catch(() => {}); // Fire-and-forget
      } else if (msgType === "display_data") {
        const content = msg.content as {
          data: Record<string, unknown>;
          metadata: Record<string, unknown>;
          transient?: { display_id?: string };
        };
        const output = {
          output_type: "display_data" as const,
          data: content.data,
          metadata: content.metadata,
          display_id: content.transient?.display_id,
        };
        onOutput(cellId, output, { parentMsgId: msg.parent_header?.msg_id });
        // Sync output to Automerge for cross-window sync
        invoke("sync_append_output", {
          cellId,
          outputJson: JSON.stringify(output),
        }).catch(() => {}); // Fire-and-forget
      } else if (msgType === "execute_result") {
        const content = msg.content as {
          data: Record<string, unknown>;
          metadata: Record<string, unknown>;
          execution_count: number;
        };
        const output = {
          output_type: "execute_result" as const,
          data: content.data,
          metadata: content.metadata,
          execution_count: content.execution_count,
        };
        onOutput(cellId, output, { parentMsgId: msg.parent_header?.msg_id });
        onExecutionCount(cellId, content.execution_count);
        // Sync output and execution count to Automerge for cross-window sync
        invoke("sync_append_output", {
          cellId,
          outputJson: JSON.stringify(output),
        }).catch(() => {}); // Fire-and-forget
        invoke("sync_execution_count", {
          cellId,
          count: content.execution_count,
        }).catch(() => {}); // Fire-and-forget
      } else if (msgType === "error") {
        const content = msg.content as {
          ename: string;
          evalue: string;
          traceback: string[];
        };
        const output = {
          output_type: "error" as const,
          ename: content.ename,
          evalue: content.evalue,
          traceback: content.traceback,
        };
        onOutput(cellId, output, { parentMsgId: msg.parent_header?.msg_id });
        // Sync error output to Automerge for cross-window sync
        invoke("sync_append_output", {
          cellId,
          outputJson: JSON.stringify(output),
        }).catch(() => {}); // Fire-and-forget
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
      pageUnlisten.then((fn) => fn());
      lifecycleUnlisten.then((fn) => fn());
    };
  }, []); // Empty deps - callbacks accessed via ref

  const startKernel = useCallback(async (name: string) => {
    setKernelStatus("starting");
    setEnvSource(null);
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
      setEnvSource("uv:inline");
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
      setEnvSource("conda:inline");
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
      console.log(
        "[kernel] starting default kernel (backend will choose uv or conda)",
      );
      const source = await invoke<string>("start_default_kernel");
      console.log(`[kernel] start_default_kernel succeeded, source: ${source}`);
      setEnvSource(source);
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
      setEnvSource("uv:pyproject");
      setKernelStatus("idle");
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_kernel_with_pyproject failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const startKernelWithDeno = useCallback(async () => {
    setKernelStatus("starting");
    setEnvSource(null);
    try {
      console.log("[kernel] starting Deno kernel");
      await invoke("start_kernel_with_deno");
      console.log("[kernel] start_kernel_with_deno succeeded");
      setKernelStatus("idle");
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_kernel_with_deno failed:", e);
      setKernelStatus("error");
    }
  }, []);

  const startKernelWithEnvironmentYml = useCallback(async () => {
    setKernelStatus("starting");
    try {
      console.log("[kernel] starting kernel with environment.yml");
      await invoke("start_kernel_with_environment_yml");
      console.log("[kernel] start_kernel_with_environment_yml succeeded");
      setEnvSource("conda:env_yml");
      setKernelStatus("idle");
      callbacksRef.current.onKernelStarted?.();
    } catch (e) {
      console.error("start_kernel_with_environment_yml failed:", e);
      setKernelStatus("error");
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally stable — these inner functions use refs and don't change identity
  const ensureKernelStarted = useCallback(
    async (opts?: {
      useUv?: boolean;
      useConda?: boolean;
      usePyproject?: boolean;
      useDeno?: boolean;
      useEnvironmentYml?: boolean;
    }) => {
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        // If useDeno is explicitly requested, use Deno kernel
        if (opts?.useDeno) {
          console.log("[kernel] useDeno explicitly requested");
          await startKernelWithDeno();
          return;
        }

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

        // If useEnvironmentYml is explicitly requested, use environment.yml
        if (opts?.useEnvironmentYml) {
          console.log("[kernel] useEnvironmentYml explicitly requested");
          await startKernelWithEnvironmentYml();
          return;
        }

        // Check notebook runtime from metadata - Deno notebooks should use Deno kernel
        const runtime = await invoke<string>("get_notebook_runtime");
        console.log("[kernel] notebook runtime:", runtime);

        if (runtime === "deno") {
          // Check if Deno is available
          const denoAvailable = await invoke<boolean>("check_deno_available");
          if (denoAvailable) {
            console.log("[kernel] starting Deno kernel for deno notebook");
            await startKernelWithDeno();
            return;
          } else {
            console.warn(
              "[kernel] Deno not available, notebook requires Deno runtime",
            );
            setKernelStatus("error");
            setKernelErrorMessage("Deno not available");
            return;
          }
        }

        // Python notebooks - existing logic follows

        // Check if notebook has conda dependencies (priority over uv)
        const condaDeps = await invoke<{ dependencies: string[] } | null>(
          "get_conda_dependencies",
        );

        if (condaDeps && condaDeps.dependencies.length > 0) {
          // Use conda-managed kernel for notebooks with conda dependencies
          console.log(
            "[kernel] starting conda-managed kernel with deps:",
            condaDeps.dependencies,
          );
          await startKernelWithConda();
          return;
        }

        // Check if notebook has uv inline dependencies
        const uvAvailable = await invoke<boolean>("check_uv_available");
        const deps = await invoke<{ dependencies: string[] } | null>(
          "get_notebook_dependencies",
        );

        if (deps && deps.dependencies.length > 0 && uvAvailable) {
          console.log(
            "[kernel] starting uv-managed kernel with inline deps:",
            deps.dependencies,
          );
          await startKernelWithUv();
          return;
        }

        // No inline deps — let the backend handle project file detection
        // (pyproject.toml, pixi.toml, environment.yml) using "closest wins"
        // semantics, then fall back to a prewarmed environment.
        console.log(
          "[kernel] no inline deps, deferring to backend (closest project file wins)",
        );
        await startDefaultKernel();
      } finally {
        startingRef.current = false;
      }
    },
    [
      startKernelWithUv,
      startKernelWithConda,
      startKernelWithDeno,
      startDefaultKernel,
    ],
  );

  const shutdownKernel = useCallback(async () => {
    try {
      console.log("[kernel] shutting down kernel");
      await invoke("shutdown_kernel");
      setKernelStatus("not started");
      setEnvSource(null);
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

  const restartAndRunAll = useCallback(async (): Promise<string[]> => {
    console.log("[kernel] restart and run all");
    try {
      // Backend handles: interrupt → clear → shutdown → clear outputs → queue all
      const cellIds = await invoke<string[]>("restart_and_run_all");
      // Now start the kernel — queue processor retries until it's ready
      await ensureKernelStarted();
      return cellIds;
    } catch (e) {
      console.error("restart_and_run_all failed:", e);
      return [];
    }
  }, [ensureKernelStarted]);

  return {
    kernelStatus,
    kernelErrorMessage,
    envSource,
    startKernel,
    startKernelWithUv,
    startKernelWithConda,
    startKernelWithPyproject,
    startKernelWithDeno,
    startKernelWithEnvironmentYml,
    startDefaultKernel,
    startDefaultUvKernel,
    startDefaultCondaKernel,
    ensureKernelStarted,
    interruptKernel,
    shutdownKernel,
    restartKernel,
    restartAndRunAll,
    listKernelspecs,
  };
}
