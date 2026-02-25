/**
 * Hook for daemon-owned kernel execution.
 *
 * This hook provides an interface to the daemon's kernel management,
 * enabling multi-window kernel sharing. The daemon owns the kernel lifecycle
 * and execution queue, broadcasting outputs to all connected windows.
 *
 * Note: This is separate from useKernel.ts which manages local kernels.
 * Use this when daemon execution is enabled; use useKernel for local execution.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DaemonBroadcast,
  DaemonNotebookResponse,
  JupyterOutput,
} from "../types";

/**
 * Normalize output from daemon format (JupyterMessageContent) to nbformat shape.
 *
 * The daemon serializes Rust JupyterMessageContent which wraps content in variant names
 * like `StreamContent`, `DisplayData`, etc. We need to convert to nbformat shape with
 * `output_type` field.
 */
function normalizeOutput(
  rawContent: Record<string, unknown>,
  outputType: string,
): JupyterOutput | null {
  switch (outputType) {
    case "stream": {
      // Daemon sends: { "StreamContent": { "name": "stdout", "text": "..." } }
      // We want: { "output_type": "stream", "name": "stdout", "text": "..." }
      const content =
        (rawContent.StreamContent as Record<string, unknown>) ?? rawContent;
      return {
        output_type: "stream",
        name: (content.name as "stdout" | "stderr") ?? "stdout",
        text: (content.text as string) ?? "",
      };
    }

    case "display_data": {
      // Daemon sends: { "DisplayData": { "data": {...}, "metadata": {...}, "transient": {...} } }
      const content =
        (rawContent.DisplayData as Record<string, unknown>) ?? rawContent;
      return {
        output_type: "display_data",
        data: (content.data as Record<string, unknown>) ?? {},
        metadata: (content.metadata as Record<string, unknown>) ?? {},
        display_id: (content.transient as Record<string, unknown>)
          ?.display_id as string | undefined,
      };
    }

    case "execute_result": {
      // Daemon sends: { "ExecuteResult": { "data": {...}, "metadata": {...}, "execution_count": N } }
      const content =
        (rawContent.ExecuteResult as Record<string, unknown>) ?? rawContent;
      return {
        output_type: "execute_result",
        data: (content.data as Record<string, unknown>) ?? {},
        metadata: (content.metadata as Record<string, unknown>) ?? {},
        execution_count: (content.execution_count as number) ?? null,
      };
    }

    case "error": {
      // Daemon sends: { "ErrorOutput": { "ename": "...", "evalue": "...", "traceback": [...] } }
      const content =
        (rawContent.ErrorOutput as Record<string, unknown>) ?? rawContent;
      return {
        output_type: "error",
        ename: (content.ename as string) ?? "Error",
        evalue: (content.evalue as string) ?? "",
        traceback: (content.traceback as string[]) ?? [],
      };
    }

    default:
      console.warn(`[daemon-kernel] Unknown output type: ${outputType}`);
      return null;
  }
}

/** Kernel status from daemon */
export type DaemonKernelStatus =
  | "not_started"
  | "starting"
  | "idle"
  | "busy"
  | "error"
  | "shutdown";

/** Queue state from daemon */
export interface DaemonQueueState {
  executing: string | null;
  queued: string[];
}

interface UseDaemonKernelOptions {
  /** Called when an output is produced for a cell */
  onOutput: (cellId: string, output: JupyterOutput) => void;
  /** Called when execution count is set for a cell */
  onExecutionCount: (cellId: string, count: number) => void;
  /** Called when execution completes for a cell */
  onExecutionDone: (cellId: string) => void;
  /** Called when kernel status changes */
  onStatusChange?: (status: DaemonKernelStatus, cellId?: string) => void;
  /** Called when queue state changes */
  onQueueChange?: (state: DaemonQueueState) => void;
  /** Called on kernel error */
  onKernelError?: (error: string) => void;
  /** Called when a display_data output should be updated by display_id */
  onUpdateDisplayData?: (
    displayId: string,
    data: Record<string, unknown>,
    metadata: Record<string, unknown>,
  ) => void;
  /** Called when outputs are cleared for a cell (broadcast from another window) */
  onClearOutputs?: (cellId: string) => void;
}

export function useDaemonKernel({
  onOutput,
  onExecutionCount,
  onExecutionDone,
  onStatusChange,
  onQueueChange,
  onKernelError,
  onUpdateDisplayData,
  onClearOutputs,
}: UseDaemonKernelOptions) {
  const [kernelStatus, setKernelStatus] =
    useState<DaemonKernelStatus>("not_started");
  const [queueState, setQueueState] = useState<DaemonQueueState>({
    executing: null,
    queued: [],
  });
  const [kernelInfo, setKernelInfo] = useState<{
    kernelType?: string;
    envSource?: string;
  }>({});

  // Store callbacks in refs to avoid effect re-runs
  const callbacksRef = useRef({
    onOutput,
    onExecutionCount,
    onExecutionDone,
    onStatusChange,
    onQueueChange,
    onKernelError,
    onUpdateDisplayData,
    onClearOutputs,
  });
  callbacksRef.current = {
    onOutput,
    onExecutionCount,
    onExecutionDone,
    onStatusChange,
    onQueueChange,
    onKernelError,
    onUpdateDisplayData,
    onClearOutputs,
  };

  // Listen for daemon broadcasts
  useEffect(() => {
    let cancelled = false;

    const unlisten = listen<DaemonBroadcast>("daemon:broadcast", (event) => {
      if (cancelled) return;

      const broadcast = event.payload;

      switch (broadcast.event) {
        case "kernel_status": {
          const status = broadcast.status as DaemonKernelStatus;
          setKernelStatus(status);
          callbacksRef.current.onStatusChange?.(status, broadcast.cell_id);
          break;
        }

        case "execution_started": {
          callbacksRef.current.onExecutionCount(
            broadcast.cell_id,
            broadcast.execution_count,
          );
          break;
        }

        case "output": {
          try {
            // Parse the raw content from daemon (JupyterMessageContent format)
            const rawContent = JSON.parse(broadcast.output_json);
            const outputType = broadcast.output_type;

            // Handle update_display_data separately - updates existing output by display_id
            if (outputType === "update_display_data") {
              const { onUpdateDisplayData } = callbacksRef.current;
              if (onUpdateDisplayData) {
                // The daemon sends UpdateDisplayData content wrapped in its variant
                const content = rawContent.UpdateDisplayData ?? rawContent;
                const displayId = content.transient?.display_id;
                if (displayId) {
                  onUpdateDisplayData(
                    displayId,
                    content.data ?? {},
                    content.metadata ?? {},
                  );
                }
              }
              break;
            }

            // Normalize other output types from daemon format to nbformat shape
            const output = normalizeOutput(rawContent, outputType);
            if (output) {
              callbacksRef.current.onOutput(broadcast.cell_id, output);
            }
          } catch (e) {
            console.error("[daemon-kernel] Failed to parse output:", e);
          }
          break;
        }

        case "execution_done": {
          callbacksRef.current.onExecutionDone(broadcast.cell_id);
          break;
        }

        case "queue_changed": {
          const newState: DaemonQueueState = {
            executing: broadcast.executing ?? null,
            queued: broadcast.queued,
          };
          setQueueState(newState);
          callbacksRef.current.onQueueChange?.(newState);
          break;
        }

        case "kernel_error": {
          setKernelStatus("error");
          callbacksRef.current.onKernelError?.(broadcast.error);
          break;
        }

        case "outputs_cleared": {
          callbacksRef.current.onClearOutputs?.(broadcast.cell_id);
          break;
        }
      }
    });

    // Get initial kernel info from daemon
    invoke<DaemonNotebookResponse>("get_daemon_kernel_info")
      .then((response) => {
        if (cancelled) return;
        if (response.result === "kernel_info") {
          setKernelInfo({
            kernelType: response.kernel_type,
            envSource: response.env_source,
          });
          setKernelStatus(response.status as DaemonKernelStatus);
        }
      })
      .catch((e) => {
        console.error("[daemon-kernel] Failed to get kernel info:", e);
      });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  /** Launch a kernel via the daemon */
  const launchKernel = useCallback(
    async (
      kernelType: string,
      envSource: string,
      notebookPath?: string,
    ): Promise<DaemonNotebookResponse> => {
      console.log(
        "[daemon-kernel] launching kernel:",
        kernelType,
        envSource,
        notebookPath,
      );
      setKernelStatus("starting");

      try {
        const response = await invoke<DaemonNotebookResponse>(
          "launch_kernel_via_daemon",
          { kernelType, envSource, notebookPath },
        );

        if (
          response.result === "kernel_launched" ||
          response.result === "kernel_already_running"
        ) {
          setKernelInfo({
            kernelType: response.kernel_type,
            envSource: response.env_source,
          });
          setKernelStatus("idle");
        } else if (response.result === "error") {
          setKernelStatus("error");
        }

        return response;
      } catch (e) {
        console.error("[daemon-kernel] launch failed:", e);
        setKernelStatus("error");
        throw e;
      }
    },
    [],
  );

  /** Queue a cell for execution via the daemon */
  const queueCell = useCallback(
    async (cellId: string, code: string): Promise<DaemonNotebookResponse> => {
      console.log("[daemon-kernel] queueing cell:", cellId);
      try {
        return await invoke<DaemonNotebookResponse>("queue_cell_via_daemon", {
          cellId,
          code,
        });
      } catch (e) {
        console.error("[daemon-kernel] queue failed:", e);
        throw e;
      }
    },
    [],
  );

  /** Clear outputs for a cell via the daemon */
  const clearOutputs = useCallback(
    async (cellId: string): Promise<DaemonNotebookResponse> => {
      console.log("[daemon-kernel] clearing outputs:", cellId);
      try {
        return await invoke<DaemonNotebookResponse>(
          "clear_outputs_via_daemon",
          {
            cellId,
          },
        );
      } catch (e) {
        console.error("[daemon-kernel] clear outputs failed:", e);
        throw e;
      }
    },
    [],
  );

  /** Interrupt kernel execution via the daemon */
  const interruptKernel =
    useCallback(async (): Promise<DaemonNotebookResponse> => {
      console.log("[daemon-kernel] interrupting kernel");
      try {
        return await invoke<DaemonNotebookResponse>("interrupt_via_daemon");
      } catch (e) {
        console.error("[daemon-kernel] interrupt failed:", e);
        throw e;
      }
    }, []);

  /** Shutdown the kernel via the daemon */
  const shutdownKernel =
    useCallback(async (): Promise<DaemonNotebookResponse> => {
      console.log("[daemon-kernel] shutting down kernel");
      try {
        const response = await invoke<DaemonNotebookResponse>(
          "shutdown_kernel_via_daemon",
        );
        setKernelStatus("not_started");
        setKernelInfo({});
        return response;
      } catch (e) {
        console.error("[daemon-kernel] shutdown failed:", e);
        throw e;
      }
    }, []);

  /** Get current queue state from daemon */
  const refreshQueueState = useCallback(async () => {
    try {
      const response = await invoke<DaemonNotebookResponse>(
        "get_daemon_queue_state",
      );
      if (response.result === "queue_state") {
        setQueueState({
          executing: response.executing ?? null,
          queued: response.queued,
        });
      }
    } catch (e) {
      console.error("[daemon-kernel] get queue state failed:", e);
    }
  }, []);

  return {
    /** Current kernel status */
    kernelStatus,
    /** Current execution queue state */
    queueState,
    /** Kernel type and environment source */
    kernelInfo,
    /** Launch a kernel via the daemon */
    launchKernel,
    /** Queue a cell for execution */
    queueCell,
    /** Clear outputs for a cell */
    clearOutputs,
    /** Interrupt kernel execution */
    interruptKernel,
    /** Shutdown the kernel */
    shutdownKernel,
    /** Refresh queue state from daemon */
    refreshQueueState,
    /** Check if a cell is currently executing */
    isCellExecuting: (cellId: string) => queueState.executing === cellId,
    /** Check if a cell is in the queue */
    isCellQueued: (cellId: string) =>
      queueState.executing === cellId || queueState.queued.includes(cellId),
  };
}
