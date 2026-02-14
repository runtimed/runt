import { useState, useEffect } from "react";
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

  // Check Deno availability and detect config on mount
  useEffect(() => {
    const init = async () => {
      try {
        const available = await invoke<boolean>("check_deno_available");
        setDenoAvailable(available);

        const config = await invoke<DenoConfigInfo | null>("detect_deno_config");
        setDenoConfigInfo(config);
      } catch (e) {
        console.error("Failed to initialize Deno dependencies:", e);
      }
    };
    init();
  }, []);

  return {
    denoAvailable,
    denoConfigInfo,
  };
}
