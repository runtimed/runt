import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { EnvProgressEvent, EnvProgressPhase } from "../types";

export interface EnvProgressState {
  /** Whether environment preparation is currently active */
  isActive: boolean;
  /** Current phase name */
  phase: string | null;
  /** Environment type (conda or uv) */
  envType: "conda" | "uv" | null;
  /** Error message if phase is "error" */
  error: string | null;
  /** Human-readable status text */
  statusText: string;
  /** Elapsed time for current/last operation in ms */
  elapsedMs: number | null;
}

function getStatusText(event: EnvProgressEvent): string {
  const phase = event.phase;
  switch (phase) {
    case "starting":
      return "Preparing environment...";
    case "cache_hit":
      return "Using cached environment";
    case "fetching_repodata": {
      const e = event as Extract<EnvProgressPhase, { phase: "fetching_repodata" }>;
      return `Fetching package index (${e.channels.join(", ")})`;
    }
    case "repodata_complete": {
      const e = event as Extract<EnvProgressPhase, { phase: "repodata_complete" }>;
      return `Loaded ${e.record_count.toLocaleString()} packages`;
    }
    case "solving": {
      const e = event as Extract<EnvProgressPhase, { phase: "solving" }>;
      return `Solving dependencies (${e.spec_count} specs)`;
    }
    case "solve_complete": {
      const e = event as Extract<EnvProgressPhase, { phase: "solve_complete" }>;
      return `Resolved ${e.package_count} packages`;
    }
    case "installing": {
      const e = event as Extract<EnvProgressPhase, { phase: "installing" }>;
      return `Installing ${e.total} packages...`;
    }
    case "install_complete":
      return "Installation complete";
    case "ready":
      return "Environment ready";
    case "error": {
      const e = event as Extract<EnvProgressPhase, { phase: "error" }>;
      return `Error: ${e.message}`;
    }
    default:
      return "Preparing...";
  }
}

export function useEnvProgress() {
  const [state, setState] = useState<EnvProgressState>({
    isActive: false,
    phase: null,
    envType: null,
    error: null,
    statusText: "",
    elapsedMs: null,
  });

  useEffect(() => {
    let cancelled = false;

    const unlisten = listen<EnvProgressEvent>("env:progress", (event) => {
      if (cancelled) return;

      const payload = event.payload;
      const phase = payload.phase;
      const isTerminal = phase === "ready" || phase === "error" || phase === "cache_hit";
      const error = phase === "error"
        ? (payload as Extract<EnvProgressPhase, { phase: "error" }>).message
        : null;

      // Extract elapsed_ms from phases that have it
      let elapsedMs: number | null = null;
      if ("elapsed_ms" in payload && typeof payload.elapsed_ms === "number") {
        elapsedMs = payload.elapsed_ms;
      }

      setState({
        isActive: !isTerminal,
        phase,
        envType: payload.env_type,
        error,
        statusText: getStatusText(payload),
        elapsedMs,
      });
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  const reset = useCallback(() => {
    setState({
      isActive: false,
      phase: null,
      envType: null,
      error: null,
      statusText: "",
      elapsedMs: null,
    });
  }, []);

  return { ...state, reset };
}
