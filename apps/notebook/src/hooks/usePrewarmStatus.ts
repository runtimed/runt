import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PoolStatus {
  available: number;
  creating: number;
  target: number;
}

export interface PrewarmStatus {
  uv: PoolStatus | null;
  conda: PoolStatus | null;
}

export function usePrewarmStatus(): PrewarmStatus {
  const [uvStatus, setUvStatus] = useState<PoolStatus | null>(null);
  const [condaStatus, setCondaStatus] = useState<PoolStatus | null>(null);

  useEffect(() => {
    const fetchBoth = async () => {
      try {
        const [uv, conda] = await Promise.all([
          invoke<PoolStatus | null>("get_prewarm_status"),
          invoke<PoolStatus | null>("get_conda_pool_status"),
        ]);
        setUvStatus(uv);
        setCondaStatus(conda);
      } catch (e) {
        console.error("Failed to get prewarm status:", e);
      }
    };

    // Initial fetch
    fetchBoth();

    // Poll every 5 seconds to update the status
    const interval = setInterval(fetchBoth, 5000);

    return () => clearInterval(interval);
  }, []);

  return { uv: uvStatus, conda: condaStatus };
}
