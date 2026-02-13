import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NotebookDependencies {
  dependencies: string[];
  requires_python: string | null;
}

export function useDependencies() {
  const [dependencies, setDependencies] =
    useState<NotebookDependencies | null>(null);
  const [uvAvailable, setUvAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  // Track if deps were synced to a running kernel (user may need to restart for some changes)
  const [syncedWhileRunning, setSyncedWhileRunning] = useState(false);
  // Track if user added deps but kernel isn't uv-managed (needs restart)
  const [needsKernelRestart, setNeedsKernelRestart] = useState(false);

  // Check if uv is available on mount
  useEffect(() => {
    invoke<boolean>("check_uv_available").then(setUvAvailable);
  }, []);

  const loadDependencies = useCallback(async () => {
    try {
      const deps = await invoke<NotebookDependencies | null>(
        "get_notebook_dependencies"
      );
      setDependencies(deps);
    } catch (e) {
      console.error("Failed to load dependencies:", e);
    }
  }, []);

  // Load dependencies on mount
  useEffect(() => {
    loadDependencies();
  }, [loadDependencies]);

  // Try to sync deps to running kernel
  const syncToKernel = useCallback(async (): Promise<boolean> => {
    try {
      // Check if kernel is even running
      const isRunning = await invoke<boolean>("is_kernel_running");
      if (!isRunning) {
        // No kernel running yet - deps will be used when kernel starts
        console.log("[deps] No kernel running, deps will be used on start");
        return false;
      }

      // Check if kernel is running with uv environment
      const hasUvEnv = await invoke<boolean>("kernel_has_uv_env");

      if (!hasUvEnv) {
        // Kernel is running but not with uv - user needs to restart
        console.log("[deps] Kernel not uv-managed, cannot sync - restart needed");
        setNeedsKernelRestart(true);
        return false;
      }

      const synced = await invoke<boolean>("sync_kernel_dependencies");
      if (synced) {
        setSyncedWhileRunning(true);
        setNeedsKernelRestart(false);
      }
      return synced;
    } catch (e) {
      console.error("Failed to sync dependencies to kernel:", e);
      return false;
    }
  }, []);

  const addDependency = useCallback(
    async (pkg: string) => {
      if (!pkg.trim()) return;
      setLoading(true);
      try {
        await invoke("add_dependency", { package: pkg.trim() });
        await loadDependencies();
        // Try to sync to running kernel
        await syncToKernel();
      } catch (e) {
        console.error("Failed to add dependency:", e);
      } finally {
        setLoading(false);
      }
    },
    [loadDependencies, syncToKernel]
  );

  const removeDependency = useCallback(
    async (pkg: string) => {
      setLoading(true);
      try {
        await invoke("remove_dependency", { package: pkg });
        await loadDependencies();
        // Note: removing a dep doesn't uninstall from running kernel
        // User would need to restart for that
        const hasUvEnv = await invoke<boolean>("kernel_has_uv_env");
        if (hasUvEnv) {
          setSyncedWhileRunning(true);
        }
      } catch (e) {
        console.error("Failed to remove dependency:", e);
      } finally {
        setLoading(false);
      }
    },
    [loadDependencies]
  );

  // Clear the synced notice (e.g., when kernel restarts)
  const clearSyncNotice = useCallback(() => {
    setSyncedWhileRunning(false);
    setNeedsKernelRestart(false);
  }, []);

  const setRequiresPython = useCallback(
    async (version: string | null) => {
      setLoading(true);
      try {
        await invoke("set_notebook_dependencies", {
          dependencies: dependencies?.dependencies ?? [],
          requiresPython: version,
        });
        await loadDependencies();
      } catch (e) {
        console.error("Failed to set requires-python:", e);
      } finally {
        setLoading(false);
      }
    },
    [dependencies, loadDependencies]
  );

  const hasDependencies =
    dependencies !== null && dependencies.dependencies.length > 0;

  // True if uv metadata exists (even with empty deps)
  const isUvConfigured = dependencies !== null;

  return {
    dependencies,
    uvAvailable,
    hasDependencies,
    isUvConfigured,
    loading,
    syncedWhileRunning,
    needsKernelRestart,
    loadDependencies,
    addDependency,
    removeDependency,
    setRequiresPython,
    clearSyncNotice,
  };
}
