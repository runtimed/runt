import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NotebookToolbar } from "./components/NotebookToolbar";
import { NotebookView } from "./components/NotebookView";
import { useNotebook } from "./hooks/useNotebook";
import { useKernel } from "./hooks/useKernel";
import { WidgetStoreProvider, useWidgetStoreRequired } from "@/components/widgets/widget-store-context";
import { MediaProvider } from "@/components/outputs/media-provider";
import { WidgetView } from "@/components/widgets/widget-view";
import type { JupyterOutput, JupyterMessage } from "./types";

/**
 * Send a message to the kernel's shell channel via Tauri.
 * Used by the widget store for comm_msg/comm_open/comm_close.
 */
async function sendMessage(message: unknown): Promise<void> {
  try {
    await invoke("send_shell_message", { message });
  } catch (e) {
    console.error("[widget] send_shell_message failed:", e);
  }
}

function AppContent() {
  const {
    cells,
    focusedCellId,
    setFocusedCellId,
    updateCellSource,
    executeCell,
    addCell,
    deleteCell,
    save,
    dirty,
    appendOutput,
    setExecutionCount,
  } = useNotebook();

  const [executingCellIds, setExecutingCellIds] = useState<Set<string>>(
    new Set()
  );

  // Get widget store handler for routing comm messages
  const { handleMessage: handleWidgetMessage } = useWidgetStoreRequired();

  const handleOutput = useCallback(
    (cellId: string, output: JupyterOutput) => {
      appendOutput(cellId, output);
    },
    [appendOutput]
  );

  const handleExecutionCount = useCallback(
    (cellId: string, count: number) => {
      setExecutionCount(cellId, count);
    },
    [setExecutionCount]
  );

  const handleExecutionDone = useCallback(
    (cellId: string) => {
      setExecutingCellIds((prev) => {
        const next = new Set(prev);
        next.delete(cellId);
        return next;
      });
    },
    []
  );

  const handleCommMessage = useCallback(
    (msg: JupyterMessage) => {
      // Forward comm messages to the widget store's comm router
      handleWidgetMessage(msg as Parameters<typeof handleWidgetMessage>[0]);
    },
    [handleWidgetMessage]
  );

  const {
    kernelStatus,
    startKernel,
    ensureKernelStarted,
    interruptKernel,
    listKernelspecs,
  } = useKernel({
    onOutput: handleOutput,
    onExecutionCount: handleExecutionCount,
    onExecutionDone: handleExecutionDone,
    onCommMessage: handleCommMessage,
  });

  const handleExecuteCell = useCallback(
    async (cellId: string) => {
      setExecutingCellIds((prev) => new Set(prev).add(cellId));
      if (kernelStatus === "not started") {
        await ensureKernelStarted();
      }
      await executeCell(cellId);
    },
    [executeCell, kernelStatus, ensureKernelStarted]
  );

  const handleAddCell = useCallback(
    (type: "code" | "markdown", afterCellId?: string | null) => {
      addCell(type, afterCellId);
    },
    [addCell]
  );

  // Cmd+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save]);

  return (
    <div className="min-h-screen bg-background">
      <NotebookToolbar
        kernelStatus={kernelStatus}
        dirty={dirty}
        onSave={save}
        onStartKernel={startKernel}
        onInterruptKernel={interruptKernel}
        onAddCell={handleAddCell}
        listKernelspecs={listKernelspecs}
      />
      <NotebookView
        cells={cells}
        focusedCellId={focusedCellId}
        executingCellIds={executingCellIds}
        onFocusCell={setFocusedCellId}
        onUpdateCellSource={updateCellSource}
        onExecuteCell={handleExecuteCell}
        onInterruptKernel={interruptKernel}
        onDeleteCell={deleteCell}
        onAddCell={handleAddCell}
      />
    </div>
  );
}

export default function App() {
  return (
    <WidgetStoreProvider sendMessage={sendMessage}>
      <MediaProvider
        renderers={{
          "application/vnd.jupyter.widget-view+json": ({ data }) => {
            const { model_id } = data as { model_id: string };
            return <WidgetView modelId={model_id} />;
          },
        }}
      >
        <AppContent />
      </MediaProvider>
    </WidgetStoreProvider>
  );
}
