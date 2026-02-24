import { useEffect, useState } from "react";
import {
  getRendererBundle,
  loadRendererBundle,
  type RendererBundle,
} from "../renderer-bundle";

/**
 * Hook to load the isolated renderer bundle lazily.
 *
 * Returns null while loading, then the bundle once ready.
 * Uses singleton caching - multiple components share the same load.
 *
 * If the bundle was preloaded (via preloadRendererBundle), the initial
 * state will have it immediately, avoiding a flash of empty content.
 */
export function useRendererBundle(): RendererBundle | null {
  // Use synchronous getter for initial state - if preloaded, we get it immediately
  const [bundle, setBundle] = useState<RendererBundle | null>(
    getRendererBundle,
  );

  useEffect(() => {
    // If not already loaded, trigger load and update state when ready
    if (!bundle) {
      loadRendererBundle()
        .then((loaded) => {
          console.log("[useRendererBundle] Bundle loaded, updating state");
          setBundle(loaded);
        })
        .catch((err) => {
          console.error("[useRendererBundle] Failed to load bundle:", err);
        });
    }
  }, [bundle]);

  return bundle;
}
