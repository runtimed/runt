import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IsolationTest } from "@/components/outputs/isolated";
import { MediaProvider } from "@/components/outputs/media-provider";
import {
  useWidgetStoreRequired,
  WidgetStoreProvider,
} from "@/components/widgets/widget-store-context";
import { WidgetView } from "@/components/widgets/widget-view";
import { useSyncedSettings, useSyncedTheme } from "@/hooks/useSyncedSettings";
import { CondaDependencyHeader } from "./components/CondaDependencyHeader";
import { DebugBanner } from "./components/DebugBanner";
import { DenoDependencyHeader } from "./components/DenoDependencyHeader";
import { DependencyHeader } from "./components/DependencyHeader";
import { NotebookToolbar } from "./components/NotebookToolbar";
import { NotebookView } from "./components/NotebookView";
import { TrustDialog } from "./components/TrustDialog";
import { useCondaDependencies } from "./hooks/useCondaDependencies";
import { useDenoDependencies } from "./hooks/useDenoDependencies";
import { useDependencies } from "./hooks/useDependencies";
import { useEnvProgress } from "./hooks/useEnvProgress";
import { useExecutionQueue } from "./hooks/useExecutionQueue";
import { useGitInfo } from "./hooks/useGitInfo";
import { type MimeBundle, useKernel } from "./hooks/useKernel";
import { useNotebook } from "./hooks/useNotebook";
import { usePrewarmStatus } from "./hooks/usePrewarmStatus";
import { useTrust } from "./hooks/useTrust";
import type { JupyterMessage, JupyterOutput } from "./types";

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
  const prewarmStatus = usePrewarmStatus();

  const {
    cells,
    focusedCellId,
    setFocusedCellId,
    updateCellSource,
    addCell,
    deleteCell,
    save,
    openNotebook,
    cloneNotebook,
    dirty,
    appendOutput,
    updateOutputByDisplayId,
    setExecutionCount,
    clearCellOutputs,
    formatCell,
  } = useNotebook();

  const { theme, setTheme } = useSyncedTheme();
  const {
    defaultRuntime,
    setDefaultRuntime,
    defaultPythonEnv,
    setDefaultPythonEnv,
    defaultUvPackages,
    setDefaultUvPackages,
    defaultCondaPackages,
    setDefaultCondaPackages,
  } = useSyncedSettings();

  // Execution queue - cells are queued and executed in FIFO order by the backend
  const {
    queueCell,
    runAllCells,
    queuedCellIds: executingCellIds,
  } = useExecutionQueue();

  const [dependencyHeaderOpen, setDependencyHeaderOpen] = useState(false);
  const [showIsolationTest, setShowIsolationTest] = useState(false);
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);
  const [clearingDeps, setClearingDeps] = useState(false);

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

  // Notebook runtime type (python or deno)
  const [runtime, setRuntime] = useState<"python" | "deno">("python");

  // Load runtime from notebook metadata on mount
  useEffect(() => {
    invoke<string>("get_notebook_runtime").then((r) => {
      setRuntime(r as "python" | "deno");
    });
  }, []);

  // Page payload state: maps cell_id -> payload (transient, not saved)
  const [pagePayloads, setPagePayloads] = useState<
    Map<string, CellPagePayload>
  >(new Map());

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
    clearAllDependencies: clearAllUvDeps,
    syncState,
    syncNow,
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
    syncing: condaSyncing,
    syncState: condaSyncState,
    syncedWhileRunning: condaSyncedWhileRunning,
    needsKernelRestart: condaNeedsKernelRestart,
    loadDependencies: loadCondaDependencies,
    addDependency: addCondaDependency,
    removeDependency: removeCondaDependency,
    clearAllDependencies: clearAllCondaDeps,
    setChannels: setCondaChannels,
    setPython: setCondaPython,
    environmentYmlInfo,
    environmentYmlDeps,
    syncNow: syncCondaNow,
    pixiInfo,
    importFromPixi,
  } = useCondaDependencies();

  // Deno config detection and settings
  const {
    denoAvailable,
    denoConfigInfo,
    flexibleNpmImports,
    setFlexibleNpmImports,
  } = useDenoDependencies();

  // Combine hasDependencies for toolbar badge
  // For Deno, show badge if deno.json is found with imports
  const hasDependencies =
    runtime === "deno"
      ? (denoConfigInfo?.has_imports ?? false)
      : hasUvDependencies ||
        hasCondaDependencies ||
        (environmentYmlInfo?.has_dependencies ?? false);

  // Get widget store handler for routing comm messages
  const {
    handleMessage: handleWidgetMessage,
    store: widgetStore,
    sendUpdate: sendWidgetUpdate,
  } = useWidgetStoreRequired();

  const handleOutput = useCallback(
    (
      cellId: string,
      output: JupyterOutput,
      meta?: { parentMsgId?: string },
    ) => {
      const parentMsgId = meta?.parentMsgId;
      let capturedByOutputWidget = false;

      // ipywidgets OutputModel uses `msg_id` to capture regular IOPub outputs.
      // Route matching outputs into OutputModel.state.outputs and sync to kernel.
      if (parentMsgId) {
        for (const [commId, model] of widgetStore.getSnapshot()) {
          const isOutputModel =
            model.modelName === "OutputModel" ||
            model.modelModule === "@jupyter-widgets/output";
          if (!isOutputModel) continue;

          const modelMsgId =
            typeof model.state.msg_id === "string"
              ? model.state.msg_id
              : undefined;
          if (modelMsgId !== parentMsgId) continue;

          const currentOutputs = Array.isArray(model.state.outputs)
            ? (model.state.outputs as JupyterOutput[])
            : [];
          const nextOutputs = [...currentOutputs, output];

          sendWidgetUpdate(commId, { outputs: nextOutputs });
          capturedByOutputWidget = true;
        }
      }

      if (capturedByOutputWidget) {
        return;
      }

      appendOutput(cellId, output);
    },
    [appendOutput, sendWidgetUpdate, widgetStore],
  );

  const handleExecutionCount = useCallback(
    (cellId: string, count: number) => {
      setExecutionCount(cellId, count);
    },
    [setExecutionCount],
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
    [handleWidgetMessage],
  );

  const handlePagePayload = useCallback(
    (cellId: string, data: MimeBundle, start: number) => {
      setPagePayloads((prev) => {
        const next = new Map(prev);
        next.set(cellId, { data, start });
        return next;
      });
    },
    [],
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
    kernelErrorMessage,
    envSource,
    ensureKernelStarted,
    startKernelWithPyproject,
    interruptKernel,
    restartKernel,
    restartAndRunAll,
    listKernelspecs,
  } = useKernel({
    onOutput: handleOutput,
    onExecutionCount: handleExecutionCount,
    onExecutionDone: handleExecutionDone,
    onCommMessage: handleCommMessage,
    onKernelStarted: loadCondaDependencies,
    onPagePayload: handlePagePayload,
    onUpdateDisplayData: updateOutputByDisplayId,
  });

  // When kernel is running and we know the env source, use it to determine panel type.
  // This handles: both-deps (backend picks based on preference), pixi (auto-detected, no metadata).
  // Fall back to metadata-based detection when kernel hasn't started yet.
  const envType = envSource?.startsWith("conda:")
    ? "conda"
    : envSource?.startsWith("uv:")
      ? "uv"
      : isUvConfigured && uvAvailable !== false
        ? "uv"
        : isCondaConfigured ||
            environmentYmlInfo?.has_dependencies ||
            uvAvailable === false
          ? "conda"
          : null;

  // Pre-start hint for the env badge (more specific than envType: distinguishes pixi)
  const envTypeHint = envSource
    ? null // backend has spoken, no hint needed
    : pixiInfo?.has_dependencies
      ? ("pixi" as const)
      : envType === "conda"
        ? ("conda" as const)
        : envType === "uv"
          ? ("uv" as const)
          : null;

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
      // Clear outputs immediately so user sees feedback
      clearCellOutputs(cellId);
      // Queue FIRST to preserve order - don't await so rapid executions queue in order
      queueCell(cellId);
      // Then ensure kernel is started (queue processor will wait for it)
      if (kernelStatus === "not started") {
        tryStartKernel();
      }
    },
    [clearCellOutputs, queueCell, kernelStatus, tryStartKernel],
  );

  const handleAddCell = useCallback(
    (type: "code" | "markdown", afterCellId?: string | null) => {
      addCell(type, afterCellId);
    },
    [addCell],
  );

  // Wrapper for toolbar's start kernel - uses trust check before starting
  const handleStartKernel = useCallback(
    async (_name: string) => {
      await tryStartKernel();
    },
    [tryStartKernel],
  );

  const handleRunAllCells = useCallback(async () => {
    // Backend clears outputs and emits cells:outputs_cleared before queuing
    await runAllCells();
    // Start kernel if not running — queue processor retries until ready
    if (kernelStatus === "not started") {
      tryStartKernel();
    }
  }, [runAllCells, kernelStatus, tryStartKernel]);

  const handleRestartAndRunAll = useCallback(async () => {
    // Backend clears outputs and emits cells:outputs_cleared before queuing,
    // then ensureKernelStarted restarts the kernel
    await restartAndRunAll();
  }, [restartAndRunAll]);

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

  // Clone notebook via native menu
  useEffect(() => {
    const unlistenPromise = listen("menu:clone", () => {
      cloneNotebook();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [cloneNotebook]);

  // Kernel menu: Run All Cells
  useEffect(() => {
    const unlistenPromise = listen("menu:run-all", () => {
      handleRunAllCells();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [handleRunAllCells]);

  // Kernel menu: Restart & Run All Cells
  useEffect(() => {
    const unlistenPromise = listen("menu:restart-and-run-all", () => {
      handleRestartAndRunAll();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [handleRestartAndRunAll]);

  // Zoom controls via native menu
  useEffect(() => {
    const webview = getCurrentWebview();
    let currentZoom = 1.0;

    const handleZoomIn = () => {
      currentZoom = Math.min(3.0, currentZoom + 0.1);
      webview.setZoom(currentZoom);
    };

    const handleZoomOut = () => {
      currentZoom = Math.max(0.5, currentZoom - 0.1);
      webview.setZoom(currentZoom);
    };

    const handleZoomReset = () => {
      currentZoom = 1.0;
      webview.setZoom(1.0);
    };

    const unlistenIn = listen("menu:zoom-in", handleZoomIn);
    const unlistenOut = listen("menu:zoom-out", handleZoomOut);
    const unlistenReset = listen("menu:zoom-reset", handleZoomReset);

    return () => {
      unlistenIn.then((u) => u());
      unlistenOut.then((u) => u());
      unlistenReset.then((u) => u());
    };
  }, []);

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
    <div className="flex h-full flex-col bg-background overflow-hidden">
      {gitInfo && (
        <DebugBanner
          branch={gitInfo.branch}
          commit={gitInfo.commit}
          description={gitInfo.description}
          uvPoolStatus={prewarmStatus.uv}
          condaPoolStatus={prewarmStatus.conda}
        />
      )}
      <NotebookToolbar
        kernelStatus={kernelStatus}
        kernelErrorMessage={kernelErrorMessage}
        envSource={envSource}
        envTypeHint={envTypeHint}
        dirty={dirty}
        hasDependencies={hasDependencies}
        theme={theme}
        envProgress={
          envProgress.isActive || envProgress.error ? envProgress : null
        }
        runtime={runtime}
        onThemeChange={setTheme}
        defaultRuntime={defaultRuntime}
        onDefaultRuntimeChange={setDefaultRuntime}
        defaultPythonEnv={defaultPythonEnv}
        onDefaultPythonEnvChange={setDefaultPythonEnv}
        defaultUvPackages={defaultUvPackages}
        onDefaultUvPackagesChange={setDefaultUvPackages}
        defaultCondaPackages={defaultCondaPackages}
        onDefaultCondaPackagesChange={setDefaultCondaPackages}
        onSave={save}
        onStartKernel={handleStartKernel}
        onInterruptKernel={interruptKernel}
        onRestartKernel={restartKernel}
        onRunAllCells={handleRunAllCells}
        onRestartAndRunAll={handleRestartAndRunAll}
        onAddCell={handleAddCell}
        onToggleDependencies={() => setDependencyHeaderOpen((prev) => !prev)}
        isDepsOpen={dependencyHeaderOpen}
        listKernelspecs={listKernelspecs}
      />
      {/* Dual-dependency choice: both UV and conda deps exist, let user pick */}
      {dependencyHeaderOpen &&
        runtime === "python" &&
        hasUvDependencies &&
        hasCondaDependencies && (
          <div className="border-b bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <span className="shrink-0">&#9888;</span>
              <span className="font-medium">
                This notebook has both uv and conda dependencies.
              </span>
              <div className="flex gap-1.5 ml-auto shrink-0">
                <button
                  disabled={clearingDeps}
                  onClick={async () => {
                    setClearingDeps(true);
                    try {
                      await clearAllCondaDeps();
                    } finally {
                      setClearingDeps(false);
                    }
                  }}
                  className="px-2 py-0.5 text-xs font-medium rounded bg-fuchsia-100 dark:bg-fuchsia-900/40 hover:bg-fuchsia-200 dark:hover:bg-fuchsia-800/50 text-fuchsia-800 dark:text-fuchsia-300 border border-fuchsia-300 dark:border-fuchsia-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Use uv ({dependencies?.dependencies?.length ?? 0}{" "}
                  {(dependencies?.dependencies?.length ?? 0) === 1
                    ? "package"
                    : "packages"}
                  )
                </button>
                <button
                  disabled={clearingDeps}
                  onClick={async () => {
                    setClearingDeps(true);
                    try {
                      await clearAllUvDeps();
                    } finally {
                      setClearingDeps(false);
                    }
                  }}
                  className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-100 dark:bg-emerald-900/40 hover:bg-emerald-200 dark:hover:bg-emerald-800/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Use conda ({condaDependencies?.dependencies?.length ?? 0}{" "}
                  {(condaDependencies?.dependencies?.length ?? 0) === 1
                    ? "package"
                    : "packages"}
                  )
                </button>
              </div>
            </div>
          </div>
        )}
      {dependencyHeaderOpen && runtime === "deno" && (
        <DenoDependencyHeader
          denoAvailable={denoAvailable}
          denoConfigInfo={denoConfigInfo}
          flexibleNpmImports={flexibleNpmImports}
          onSetFlexibleNpmImports={setFlexibleNpmImports}
        />
      )}
      {dependencyHeaderOpen && runtime === "python" && envType === "conda" && (
        <CondaDependencyHeader
          dependencies={condaDependencies?.dependencies ?? []}
          channels={condaDependencies?.channels ?? []}
          python={condaDependencies?.python ?? null}
          loading={condaDepsLoading}
          syncing={condaSyncing}
          syncState={condaSyncState}
          syncedWhileRunning={condaSyncedWhileRunning}
          needsKernelRestart={condaNeedsKernelRestart}
          onAdd={addCondaDependency}
          onRemove={removeCondaDependency}
          onSetChannels={setCondaChannels}
          onSetPython={setCondaPython}
          onSyncNow={syncCondaNow}
          envProgress={envProgress.envType === "conda" ? envProgress : null}
          onResetProgress={envProgress.reset}
          environmentYmlInfo={environmentYmlInfo}
          environmentYmlDeps={environmentYmlDeps}
          pixiInfo={pixiInfo}
          onImportFromPixi={importFromPixi}
        />
      )}
      {dependencyHeaderOpen && runtime === "python" && envType !== "conda" && (
        <DependencyHeader
          dependencies={dependencies?.dependencies ?? []}
          requiresPython={dependencies?.requires_python ?? null}
          uvAvailable={uvAvailable}
          loading={depsLoading}
          syncedWhileRunning={syncedWhileRunning}
          needsKernelRestart={needsKernelRestart}
          onAdd={addDependency}
          onRemove={removeDependency}
          syncState={syncState}
          onSyncNow={syncNow}
          pyprojectInfo={pyprojectInfo}
          pyprojectDeps={pyprojectDeps}
          onImportFromPyproject={importFromPyproject}
          onUseProjectEnv={startKernelWithPyproject}
          isUsingProjectEnv={envSource === "uv:pyproject"}
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
        runtime={runtime}
        onFocusCell={setFocusedCellId}
        onUpdateCellSource={updateCellSource}
        onExecuteCell={handleExecuteCell}
        onInterruptKernel={interruptKernel}
        onDeleteCell={deleteCell}
        onAddCell={handleAddCell}
        onClearPagePayload={clearPagePayload}
        onFormatCell={formatCell}
      />
    </div>
  );
}

function AppErrorFallback(_error: Error, resetErrorBoundary: () => void) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The notebook encountered an unexpected error.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={resetErrorBoundary}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallback={AppErrorFallback}>
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
    </ErrorBoundary>
  );
}
