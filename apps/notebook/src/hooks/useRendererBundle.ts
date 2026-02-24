import { useEffect, useState } from "react";
import { loadRendererBundle, type RendererBundle } from "../renderer-bundle";

/**
 * Hook to load the isolated renderer bundle lazily.
 *
 * Returns null while loading, then the bundle once ready.
 * Uses singleton caching - multiple components share the same load.
 */
export function useRendererBundle(): RendererBundle | null {
  const [bundle, setBundle] = useState<RendererBundle | null>(null);

  useEffect(() => {
    loadRendererBundle().then(setBundle);
  }, []);

  return bundle;
}
