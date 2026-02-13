import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface CondaDependencies {
  dependencies: string[];
  channels: string[];
  python: string | null;
}

export function useCondaDependencies() {
  const [dependencies, setDependencies] = useState<CondaDependencies | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  // Track if deps were synced to a running kernel (user may need to restart for some changes)
  const [syncedWhileRunning, setSyncedWhileRunning] = useState(false);
  // Track if user added deps but kernel isn't conda-managed (needs restart)
  const [needsKernelRestart, setNeedsKernelRestart] = useState(false);

  const loadDependencies = useCallback(async () => {
    try {
      const deps = await invoke<CondaDependencies | null>(
        "get_conda_dependencies"
      );
      setDependencies(deps);
    } catch (e) {
      console.error("Failed to load conda dependencies:", e);
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
        console.log("[conda] No kernel running, deps will be used on start");
        return false;
      }

      // Check if kernel is running with conda environment
      const hasCondaEnv = await invoke<boolean>("kernel_has_conda_env");

      if (!hasCondaEnv) {
        // Kernel is running but not with conda - user needs to restart
        console.log(
          "[conda] Kernel not conda-managed, cannot sync - restart needed"
        );
        setNeedsKernelRestart(true);
        return false;
      }

      // Try to sync new packages to the running conda environment
      try {
        const synced = await invoke<boolean>("sync_conda_dependencies");
        if (synced) {
          setSyncedWhileRunning(true);
          setNeedsKernelRestart(false);
        }
        return synced;
      } catch {
        // Sync failed - may need restart for complex dependency changes
        setNeedsKernelRestart(true);
        return false;
      }
    } catch (e) {
      console.error("Failed to sync conda dependencies to kernel:", e);
      return false;
    }
  }, []);

  const addDependency = useCallback(
    async (pkg: string) => {
      if (!pkg.trim()) return;
      setLoading(true);
      try {
        await invoke("add_conda_dependency", { package: pkg.trim() });
        await loadDependencies();
        // Try to sync to running kernel
        await syncToKernel();
      } catch (e) {
        console.error("Failed to add conda dependency:", e);
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
        await invoke("remove_conda_dependency", { package: pkg });
        await loadDependencies();
        // Note: removing a dep doesn't uninstall from running kernel
        // User would need to restart for that
        const hasCondaEnv = await invoke<boolean>("kernel_has_conda_env");
        if (hasCondaEnv) {
          setNeedsKernelRestart(true);
        }
      } catch (e) {
        console.error("Failed to remove conda dependency:", e);
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

  const setChannels = useCallback(
    async (channels: string[]) => {
      setLoading(true);
      try {
        await invoke("set_conda_dependencies", {
          dependencies: dependencies?.dependencies ?? [],
          channels,
          python: dependencies?.python ?? null,
        });
        await loadDependencies();
      } catch (e) {
        console.error("Failed to set channels:", e);
      } finally {
        setLoading(false);
      }
    },
    [dependencies, loadDependencies]
  );

  const setPython = useCallback(
    async (version: string | null) => {
      setLoading(true);
      try {
        await invoke("set_conda_dependencies", {
          dependencies: dependencies?.dependencies ?? [],
          channels: dependencies?.channels ?? [],
          python: version,
        });
        await loadDependencies();
      } catch (e) {
        console.error("Failed to set python version:", e);
      } finally {
        setLoading(false);
      }
    },
    [dependencies, loadDependencies]
  );

  const hasDependencies =
    dependencies !== null && dependencies.dependencies.length > 0;

  return {
    dependencies,
    hasDependencies,
    loading,
    syncedWhileRunning,
    needsKernelRestart,
    loadDependencies,
    addDependency,
    removeDependency,
    setChannels,
    setPython,
    clearSyncNotice,
  };
}
