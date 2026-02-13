import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { NotebookToolbar } from "./components/NotebookToolbar";
import { NotebookView } from "./components/NotebookView";
import { DependencyHeader } from "./components/DependencyHeader";
import { CondaDependencyHeader } from "./components/CondaDependencyHeader";
import { DebugBanner } from "./components/DebugBanner";
import { useNotebook } from "./hooks/useNotebook";
import { useKernel, type MimeBundle } from "./hooks/useKernel";
import { useDependencies } from "./hooks/useDependencies";
import { useCondaDependencies } from "./hooks/useCondaDependencies";
import { useGitInfo } from "./hooks/useGitInfo";
import { useTheme } from "@/hooks/useTheme";
import { WidgetStoreProvider, useWidgetStoreRequired } from "@/components/widgets/widget-store-context";
import { MediaProvider } from "@/components/outputs/media-provider";
import { WidgetView } from "@/components/widgets/widget-view";
import type { JupyterOutput, JupyterMessage } from "./types";

/** Page payload data for a cell */
export interface CellPagePayload {
  data: MimeBundle;
  start: number;
}

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
  const gitInfo = useGitInfo();

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

  // Page payload state: maps cell_id -> payload (transient, not saved)
  const [pagePayloads, setPagePayloads] = useState<Map<string, CellPagePayload>>(
    new Map()
  );

  // UV Dependency management
  const {
    dependencies,
    uvAvailable,
    hasDependencies: hasUvDependencies,
    isUvConfigured,
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
    isCondaConfigured,
    loading: condaDepsLoading,
    syncedWhileRunning: condaSyncedWhileRunning,
    needsKernelRestart: condaNeedsKernelRestart,
    loadDependencies: loadCondaDependencies,
    addDependency: addCondaDependency,
    removeDependency: removeCondaDependency,
    setChannels: setCondaChannels,
    setPython: setCondaPython,
  } = useCondaDependencies();

  // Auto-detect environment type based on what's configured
  // uv takes priority if metadata exists (even with empty deps)
  const envType = isUvConfigured
    ? "uv"
    : isCondaConfigured
      ? "conda"
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

  const handlePagePayload = useCallback(
    (cellId: string, data: MimeBundle, start: number) => {
      setPagePayloads((prev) => {
        const next = new Map(prev);
        next.set(cellId, { data, start });
        return next;
      });
    },
    []
  );

  // Clear page payload for a cell (e.g., when dismissed or re-executed)
  const clearPagePayload = useCallback((cellId: string) => {
    setPagePayloads((prev) => {
      const next = new Map(prev);
      next.delete(cellId);
      return next;
    });
  }, []);

  const {
    kernelStatus,
    ensureKernelStarted,
    interruptKernel,
    restartKernel,
    listKernelspecs,
  } = useKernel({
    onOutput: handleOutput,
    onExecutionCount: handleExecutionCount,
    onExecutionDone: handleExecutionDone,
    onCommMessage: handleCommMessage,
onKernelStarted: loadCondaDependencies,
    onPagePayload: handlePagePayload,
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

  // Cmd+S to save (keyboard and native menu)
  useEffect(() => {
    // Listen for native menu save event
    const unlistenPromise = listen("menu:save", () => {
      save();
    });

    // Keep keyboard shortcut as fallback
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [save]);

  return (
    <div className="min-h-screen bg-background">
      {gitInfo && (
        <DebugBanner
          branch={gitInfo.branch}
          commit={gitInfo.commit}
          description={gitInfo.description}
        />
      )}
      <NotebookToolbar
        kernelStatus={kernelStatus}
        dirty={dirty}
        hasDependencies={hasDependencies}
        theme={theme}
        onThemeChange={setTheme}
        onSave={save}
        onStartKernel={handleStartKernel}
        onInterruptKernel={interruptKernel}
        onRestartKernel={restartKernel}
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
        pagePayloads={pagePayloads}
        onFocusCell={setFocusedCellId}
        onUpdateCellSource={updateCellSource}
        onExecuteCell={handleExecuteCell}
        onInterruptKernel={interruptKernel}
        onDeleteCell={deleteCell}
        onAddCell={handleAddCell}
        onClearPagePayload={clearPagePayload}
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
