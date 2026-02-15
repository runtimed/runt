import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DenoConfigInfo {
  path: string;
  relative_path: string;
  name: string | null;
  has_imports: boolean;
  has_tasks: boolean;
}

export function useDenoDependencies() {
  const [denoAvailable, setDenoAvailable] = useState<boolean | null>(null);
  const [denoConfigInfo, setDenoConfigInfo] = useState<DenoConfigInfo | null>(null);
  const [flexibleNpmImports, setFlexibleNpmImportsState] = useState<boolean>(true);

  // Check Deno availability, detect config, and load settings on mount
  useEffect(() => {
    const init = async () => {
      try {
        const available = await invoke<boolean>("check_deno_available");
        setDenoAvailable(available);

        const config = await invoke<DenoConfigInfo | null>("detect_deno_config");
        setDenoConfigInfo(config);

        const flexible = await invoke<boolean>("get_deno_flexible_npm_imports");
        setFlexibleNpmImportsState(flexible);
      } catch (e) {
        console.error("Failed to initialize Deno dependencies:", e);
      }
    };
    init();
  }, []);

  const setFlexibleNpmImports = useCallback(async (enabled: boolean) => {
    try {
      await invoke("set_deno_flexible_npm_imports", { enabled });
      setFlexibleNpmImportsState(enabled);
    } catch (e) {
      console.error("Failed to set flexible npm imports:", e);
    }
  }, []);

  return {
    denoAvailable,
    denoConfigInfo,
    flexibleNpmImports,
    setFlexibleNpmImports,
  };
}
