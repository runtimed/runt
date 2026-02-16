import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PoolStatus {
  available: number;
  creating: number;
  target: number;
}

export function usePrewarmStatus() {
  const [status, setStatus] = useState<PoolStatus | null>(null);

  useEffect(() => {
    // Initial fetch
    invoke<PoolStatus | null>("get_prewarm_status")
      .then(setStatus)
      .catch((e) => {
        console.error("Failed to get prewarm status:", e);
      });

    // Poll every 5 seconds to update the status
    const interval = setInterval(() => {
      invoke<PoolStatus | null>("get_prewarm_status")
        .then(setStatus)
        .catch((e) => {
          console.error("Failed to get prewarm status:", e);
        });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return status;
}
