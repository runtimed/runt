import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NotebookDependencies {
  dependencies: string[];
  requires_python: string | null;
}

/** Full pyproject.toml dependencies for display */
export interface PyProjectDeps {
  path: string;
  relative_path: string;
  project_name: string | null;
  dependencies: string[];
  dev_dependencies: string[];
  requires_python: string | null;
  index_url: string | null;
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

export function useDependencies() {
  const [dependencies, setDependencies] =
    useState<NotebookDependencies | null>(null);
  const [uvAvailable, setUvAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  // Track if deps were synced to a running kernel (user may need to restart for some changes)
  const [syncedWhileRunning, setSyncedWhileRunning] = useState(false);
  // Track if user added deps but kernel isn't uv-managed (needs restart)
  const [needsKernelRestart, setNeedsKernelRestart] = useState(false);

  // pyproject.toml state
  const [pyprojectInfo, setPyprojectInfo] = useState<PyProjectInfo | null>(null);
  const [pyprojectDeps, setPyprojectDeps] = useState<PyProjectDeps | null>(null);

  // Check if uv is available and detect pyproject on mount
  useEffect(() => {
    invoke<boolean>("check_uv_available").then(setUvAvailable);
    invoke<PyProjectInfo | null>("detect_pyproject").then(setPyprojectInfo);
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

  // Load full pyproject dependencies
  const loadPyprojectDeps = useCallback(async () => {
    try {
      const deps = await invoke<PyProjectDeps | null>("get_pyproject_dependencies");
      setPyprojectDeps(deps);
    } catch (e) {
      console.error("Failed to load pyproject dependencies:", e);
    }
  }, []);

  // Load pyproject deps when we detect a pyproject.toml
  useEffect(() => {
    if (pyprojectInfo?.has_dependencies) {
      loadPyprojectDeps();
    }
  }, [pyprojectInfo, loadPyprojectDeps]);

  // Import dependencies from pyproject.toml into notebook metadata
  const importFromPyproject = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("import_pyproject_dependencies");
      await loadDependencies();
      console.log("[deps] Imported dependencies from pyproject.toml");
    } catch (e) {
      console.error("Failed to import from pyproject.toml:", e);
    } finally {
      setLoading(false);
    }
  }, [loadDependencies]);

  // Refresh pyproject detection
  const refreshPyproject = useCallback(async () => {
    const info = await invoke<PyProjectInfo | null>("detect_pyproject");
    setPyprojectInfo(info);
    if (info?.has_dependencies) {
      await loadPyprojectDeps();
    } else {
      setPyprojectDeps(null);
    }
  }, [loadPyprojectDeps]);

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
    // pyproject.toml support
    pyprojectInfo,
    pyprojectDeps,
    importFromPyproject,
    refreshPyproject,
  };
}
