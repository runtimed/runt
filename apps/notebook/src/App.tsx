import { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { NotebookToolbar } from "./components/NotebookToolbar";
import { NotebookView } from "./components/NotebookView";
import { DependencyHeader } from "./components/DependencyHeader";
import { CondaDependencyHeader } from "./components/CondaDependencyHeader";
import { TrustDialog } from "./components/TrustDialog";
import { DebugBanner } from "./components/DebugBanner";
import { useNotebook } from "./hooks/useNotebook";
import { useKernel, type MimeBundle } from "./hooks/useKernel";
import { useDependencies } from "./hooks/useDependencies";
import { useCondaDependencies } from "./hooks/useCondaDependencies";
import { useTrust } from "./hooks/useTrust";
import { useGitInfo } from "./hooks/useGitInfo";
import { useEnvProgress } from "./hooks/useEnvProgress";
import { useExecutionQueue } from "./hooks/useExecutionQueue";
import { useTheme } from "@/hooks/useTheme";
import { WidgetStoreProvider, useWidgetStoreRequired } from "@/components/widgets/widget-store-context";
import { MediaProvider } from "@/components/outputs/media-provider";
import { WidgetView } from "@/components/widgets/widget-view";
import { IsolationTest } from "@/components/outputs/isolated";
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
    addCell,
    deleteCell,
    save,
    openNotebook,
    dirty,
    appendOutput,
    setExecutionCount,
  } = useNotebook();

  const { theme, setTheme } = useTheme("notebook-theme");

  // Execution queue - cells are queued and executed in FIFO order by the backend
  const { queueCell, queuedCellIds: executingCellIds } = useExecutionQueue();

  const [dependencyHeaderOpen, setDependencyHeaderOpen] = useState(false);
  const [showIsolationTest, setShowIsolationTest] = useState(false);
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);

  // Trust verification for notebook dependencies
  const {
    trustInfo,
    typosquatWarnings,
    loading: trustLoading,
    checkTrust,
    approveTrust,
  } = useTrust();

  // Track pending kernel start that was blocked by trust dialog
  const pendingKernelStartRef = useRef(false);

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
    pyprojectInfo,
    pyprojectDeps,
    importFromPyproject,
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

  // Execution completion is handled by the queue via queue:state events
  // This callback is still called by useKernel but is now a no-op
  const handleExecutionDone = useCallback((_cellId: string) => {
    // Queue handles execution tracking via backend events
  }, []);

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

  // Environment preparation progress
  const envProgress = useEnvProgress();

  // Check trust and start kernel if trusted, otherwise show dialog
  const tryStartKernel = useCallback(async () => {
    // Re-check trust status (may have changed)
    const info = await checkTrust();
    if (!info) return;

    if (info.status === "trusted" || info.status === "no_dependencies") {
      // Trusted - start kernel
      await ensureKernelStarted();
    } else {
      // Untrusted - show dialog and mark pending start
      pendingKernelStartRef.current = true;
      setTrustDialogOpen(true);
    }
  }, [checkTrust, ensureKernelStarted]);

  // Handle trust approval from dialog
  const handleTrustApprove = useCallback(async () => {
    const success = await approveTrust();
    if (success && pendingKernelStartRef.current) {
      pendingKernelStartRef.current = false;
      // Now start the kernel since trust was approved
      await ensureKernelStarted();
    }
    return success;
  }, [approveTrust, ensureKernelStarted]);

  // Handle trust decline from dialog
  const handleTrustDecline = useCallback(() => {
    pendingKernelStartRef.current = false;
    // User declined - don't start kernel, just close dialog
  }, []);

  const handleExecuteCell = useCallback(
    (cellId: string) => {
      // Queue FIRST to preserve order - don't await so rapid executions queue in order
      queueCell(cellId);
      // Then ensure kernel is started (queue processor will wait for it)
      if (kernelStatus === "not started") {
        tryStartKernel();
      }
    },
    [queueCell, kernelStatus, tryStartKernel]
  );

  const handleAddCell = useCallback(
    (type: "code" | "markdown", afterCellId?: string | null) => {
      addCell(type, afterCellId);
    },
    [addCell]
  );

  // Wrapper for toolbar's start kernel - uses trust check before starting
  const handleStartKernel = useCallback(
    async (_name: string) => {
      await tryStartKernel();
    },
    [tryStartKernel]
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

  // Cmd+O to open (keyboard and native menu)
  useEffect(() => {
    // Listen for native menu open event
    const unlistenPromise = listen("menu:open", () => {
      openNotebook();
    });

    // Keep keyboard shortcut as fallback
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        openNotebook();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [openNotebook]);

  // Cmd+Shift+I to toggle isolation test panel (dev only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "i") {
        e.preventDefault();
        setShowIsolationTest((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        envProgress={envProgress.isActive ? envProgress : null}
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
          pyprojectInfo={pyprojectInfo}
          pyprojectDeps={pyprojectDeps}
          onImportFromPyproject={importFromPyproject}
        />
      )}
      {showIsolationTest && <IsolationTest />}
      <TrustDialog
        open={trustDialogOpen}
        onOpenChange={setTrustDialogOpen}
        trustInfo={trustInfo}
        typosquatWarnings={typosquatWarnings}
        onApprove={handleTrustApprove}
        onDecline={handleTrustDecline}
        loading={trustLoading}
      />
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
