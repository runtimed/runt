import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface AvailableAppUpdate {
  version: string;
  body?: string | null;
  channel: string;
}

interface UseAppUpdaterResult {
  availableUpdate: AvailableAppUpdate | null;
  isChecking: boolean;
  isInstalling: boolean;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  installAndRelaunch: () => Promise<void>;
}

export function useAppUpdater(): UseAppUpdaterResult {
  const [availableUpdate, setAvailableUpdate] =
    useState<AvailableAppUpdate | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    const forcedVersion =
      import.meta.env.VITE_FORCE_UPDATE_VERSION?.toString().trim();
    const forcedChannel =
      import.meta.env.VITE_FORCE_UPDATE_CHANNEL?.toString().trim() || "preview";

    if (forcedVersion) {
      setAvailableUpdate({
        version: forcedVersion,
        channel: forcedChannel,
      });
      setError(null);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);

    try {
      const update = await invoke<AvailableAppUpdate | null>(
        "check_for_app_update",
      );
      setAvailableUpdate(update);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Update check failed: ${message}`);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  const installAndRelaunch = useCallback(async () => {
    if (!availableUpdate || isInstalling) {
      return;
    }

    setIsInstalling(true);
    setError(null);

    try {
      const installed = await invoke<boolean>(
        "download_and_install_app_update",
      );

      // If no update is available by the time the user clicks, clear the stale prompt.
      if (!installed) {
        setAvailableUpdate(null);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Update install failed: ${message}`);
    } finally {
      setIsInstalling(false);
    }
  }, [availableUpdate, isInstalling]);

  return {
    availableUpdate,
    isChecking,
    isInstalling,
    error,
    checkForUpdates,
    installAndRelaunch,
  };
}
