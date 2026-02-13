import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NotebookToolbar } from "./components/NotebookToolbar";
import { NotebookView } from "./components/NotebookView";
import { DependencyHeader } from "./components/DependencyHeader";
import { CondaDependencyHeader } from "./components/CondaDependencyHeader";
import { useNotebook } from "./hooks/useNotebook";
import { useKernel } from "./hooks/useKernel";
import { useDependencies } from "./hooks/useDependencies";
import { useCondaDependencies } from "./hooks/useCondaDependencies";
import { useTheme } from "@/hooks/useTheme";
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

  const { theme, setTheme } = useTheme("notebook-theme");

  const [executingCellIds, setExecutingCellIds] = useState<Set<string>>(
    new Set()
  );
  const [dependencyHeaderOpen, setDependencyHeaderOpen] = useState(false);

  // UV Dependency management
  const {
    dependencies,
    uvAvailable,
    hasDependencies: hasUvDependencies,
    loading: depsLoading,
    syncedWhileRunning,
    needsKernelRestart,
    addDependency,
    removeDependency,
  } = useDependencies();

  // Conda Dependency management
  const {
    dependencies: condaDependencies,
    hasDependencies: hasCondaDependencies,
    loading: condaDepsLoading,
    syncedWhileRunning: condaSyncedWhileRunning,
    needsKernelRestart: condaNeedsKernelRestart,
    addDependency: addCondaDependency,
    removeDependency: removeCondaDependency,
    setChannels: setCondaChannels,
    setPython: setCondaPython,
  } = useCondaDependencies();

  // Auto-detect environment type based on what's configured
  // Conda takes priority if it has dependencies
  const envType = hasCondaDependencies
    ? "conda"
    : hasUvDependencies
      ? "uv"
      : null;

  // Combine hasDependencies for toolbar badge
  const hasDependencies = hasUvDependencies || hasCondaDependencies;

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

  // Wrapper for toolbar's start kernel - uses ensureKernelStarted to check deps first
  const handleStartKernel = useCallback(
    async (_name: string) => {
      // ensureKernelStarted checks for conda/uv deps and uses the right kernel type
      await ensureKernelStarted();
    },
    [ensureKernelStarted]
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
        hasDependencies={hasDependencies}
        theme={theme}
        onThemeChange={setTheme}
        onSave={save}
        onStartKernel={handleStartKernel}
        onInterruptKernel={interruptKernel}
        onAddCell={handleAddCell}
        onToggleDependencies={() => setDependencyHeaderOpen((prev) => !prev)}
        listKernelspecs={listKernelspecs}
      />
      {dependencyHeaderOpen && envType === "conda" && (
        <CondaDependencyHeader
          dependencies={condaDependencies?.dependencies ?? []}
          channels={condaDependencies?.channels ?? []}
          python={condaDependencies?.python ?? null}
          loading={condaDepsLoading}
          syncedWhileRunning={condaSyncedWhileRunning}
          needsKernelRestart={condaNeedsKernelRestart}
          onAdd={addCondaDependency}
          onRemove={removeCondaDependency}
          onSetChannels={setCondaChannels}
          onSetPython={setCondaPython}
        />
      )}
      {dependencyHeaderOpen && envType !== "conda" && (
        <DependencyHeader
          dependencies={dependencies?.dependencies ?? []}
          requiresPython={dependencies?.requires_python ?? null}
          uvAvailable={uvAvailable}
          loading={depsLoading}
          syncedWhileRunning={syncedWhileRunning}
          needsKernelRestart={needsKernelRestart}
          onAdd={addDependency}
          onRemove={removeDependency}
        />
      )}
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
