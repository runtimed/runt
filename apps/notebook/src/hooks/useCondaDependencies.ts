import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PixiInfo } from "../types";

export interface CondaDependencies {
  dependencies: string[];
  channels: string[];
  python: string | null;
}

/** Info about a detected environment.yml */
export interface EnvironmentYmlInfo {
  path: string;
  relative_path: string;
  name: string | null;
  has_dependencies: boolean;
  dependency_count: number;
  has_pip_dependencies: boolean;
  pip_dependency_count: number;
  python: string | null;
  channels: string[];
}

/** Full environment.yml dependencies for display */
export interface EnvironmentYmlDeps {
  path: string;
  relative_path: string;
  name: string | null;
  dependencies: string[];
  pip_dependencies: string[];
  python: string | null;
  channels: string[];
}

/** Conda sync state — tracks whether declared deps match the running kernel's environment. */
export type CondaSyncState =
  | { status: "not_running" }
  | { status: "not_conda_managed" }
  | { status: "synced" }
  | { status: "dirty" };

export function useCondaDependencies() {
  const [dependencies, setDependencies] = useState<CondaDependencies | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  // Track if deps were synced to a running kernel (user may need to restart for some changes)
  const [syncedWhileRunning, setSyncedWhileRunning] = useState(false);
  // Track if user added deps but kernel isn't conda-managed (needs restart)
  const [needsKernelRestart, setNeedsKernelRestart] = useState(false);
  // Sync state for "Sync Now" button
  const [syncState, setSyncState] = useState<CondaSyncState | null>(null);
  // Whether a sync is in progress (separate from loading so input stays enabled)
  const [syncing, setSyncing] = useState(false);
  // pixi.toml detection
  const [pixiInfo, setPixiInfo] = useState<PixiInfo | null>(null);

  // environment.yml detection state
  const [environmentYmlInfo, setEnvironmentYmlInfo] = useState<EnvironmentYmlInfo | null>(null);
  const [environmentYmlDeps, setEnvironmentYmlDeps] = useState<EnvironmentYmlDeps | null>(null);

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

  // Load full environment.yml dependencies
  const loadEnvironmentYmlDeps = useCallback(async () => {
    try {
      const deps = await invoke<EnvironmentYmlDeps | null>("get_environment_yml_dependencies");
      setEnvironmentYmlDeps(deps);
    } catch (e) {
      console.error("Failed to load environment.yml dependencies:", e);
    }
  }, []);

  // Load dependencies and detect environment.yml and pixi.toml on mount
  useEffect(() => {
    loadDependencies();
    invoke<EnvironmentYmlInfo | null>("detect_environment_yml").then(setEnvironmentYmlInfo);
    invoke<PixiInfo | null>("detect_pixi_toml").then(setPixiInfo);
  }, [loadDependencies]);

  // Load environment.yml deps when we detect one
  useEffect(() => {
    if (environmentYmlInfo?.has_dependencies) {
      loadEnvironmentYmlDeps();
    }
  }, [environmentYmlInfo, loadEnvironmentYmlDeps]);

  // Re-sign the notebook after user modifications to keep it trusted
  const resignTrust = useCallback(async () => {
    try {
      await invoke("approve_notebook_trust");
    } catch (e) {
      // Signing may fail if no trust key yet - that's okay
      console.debug("[conda] Could not resign trust:", e);
    }
  }, []);

  // Check sync state between declared deps and the running kernel
  const checkSyncState = useCallback(async () => {
    try {
      const isRunning = await invoke<boolean>("is_kernel_running");
      if (!isRunning) {
        setSyncState({ status: "not_running" });
        return;
      }

      const hasCondaEnv = await invoke<boolean>("kernel_has_conda_env");
      if (!hasCondaEnv) {
        setSyncState({ status: "not_conda_managed" });
        return;
      }

      // If we reach here, kernel is running with conda — mark as dirty
      // (we can't cheaply check if they actually match, so assume dirty after changes)
      setSyncState({ status: "dirty" });
    } catch (e) {
      console.error("Failed to check conda sync state:", e);
    }
  }, []);

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
          setSyncState({ status: "synced" });
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

  // Explicit sync function for "Sync Now" button — does NOT block the input
  const syncNow = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    try {
      const synced = await syncToKernel();
      return synced;
    } finally {
      setSyncing(false);
    }
  }, [syncToKernel]);

  const addDependency = useCallback(
    async (pkg: string) => {
      if (!pkg.trim()) return;
      setLoading(true);
      try {
        await invoke("add_conda_dependency", { package: pkg.trim() });
        await loadDependencies();
        // Re-sign to keep notebook trusted after user modification
        await resignTrust();
        // Check sync state — UI will show "Sync Now" if dirty
        await checkSyncState();
      } catch (e) {
        console.error("Failed to add conda dependency:", e);
      } finally {
        setLoading(false);
      }
    },
    [loadDependencies, resignTrust, checkSyncState]
  );

  const removeDependency = useCallback(
    async (pkg: string) => {
      setLoading(true);
      try {
        await invoke("remove_conda_dependency", { package: pkg });
        await loadDependencies();
        // Re-sign to keep notebook trusted after user modification
        await resignTrust();
        // Check sync state — removing a dep doesn't uninstall from running kernel
        await checkSyncState();
      } catch (e) {
        console.error("Failed to remove conda dependency:", e);
      } finally {
        setLoading(false);
      }
    },
    [loadDependencies, resignTrust, checkSyncState]
  );

  // Clear the synced notice (e.g., when kernel restarts)
  const clearSyncNotice = useCallback(() => {
    setSyncedWhileRunning(false);
    setNeedsKernelRestart(false);
    setSyncState(null);
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
        // Re-sign to keep notebook trusted after user modification
        await resignTrust();
      } catch (e) {
        console.error("Failed to set channels:", e);
      } finally {
        setLoading(false);
      }
    },
    [dependencies, loadDependencies, resignTrust]
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
        // Re-sign to keep notebook trusted after user modification
        await resignTrust();
      } catch (e) {
        console.error("Failed to set python version:", e);
      } finally {
        setLoading(false);
      }
    },
    [dependencies, loadDependencies, resignTrust]
  );

  const hasDependencies =
    dependencies !== null && dependencies.dependencies.length > 0;

  // True if conda metadata exists (even with empty deps)
  const isCondaConfigured = dependencies !== null;

  // Import pixi.toml deps into notebook conda metadata
  const importFromPixi = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("import_pixi_dependencies");
      await loadDependencies();
      await resignTrust();
    } catch (e) {
      console.error("Failed to import pixi dependencies:", e);
    } finally {
      setLoading(false);
    }
  }, [loadDependencies, resignTrust]);

  return {
    dependencies,
    hasDependencies,
    isCondaConfigured,
    loading,
    syncing,
    syncState,
    syncedWhileRunning,
    needsKernelRestart,
    pixiInfo,
    loadDependencies,
    addDependency,
    removeDependency,
    setChannels,
    setPython,
    syncNow,
    importFromPixi,
    clearSyncNotice,
    // environment.yml support
    environmentYmlInfo,
    environmentYmlDeps,
  };
}
