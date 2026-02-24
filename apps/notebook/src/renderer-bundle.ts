/**
 * Renderer Bundle Loader
 *
 * Lazily imports the isolated renderer bundle from a virtual module that's built
 * inline during the notebook build. This eliminates the need for a separate
 * build step - the isolated renderer is compiled as part of the main build.
 *
 * The virtual module is provided by vite-plugin-isolated-renderer.
 *
 * Bundle is loaded on first access and cached. Use preloadRendererBundle()
 * to trigger loading early without blocking.
 */

export type RendererBundle = { rendererCode: string; rendererCss: string };

let bundlePromise: Promise<RendererBundle> | null = null;

/**
 * Load the renderer bundle lazily. Returns a cached promise on subsequent calls.
 */
export function loadRendererBundle(): Promise<RendererBundle> {
  if (!bundlePromise) {
    bundlePromise = import(
      "virtual:isolated-renderer"
    ) as Promise<RendererBundle>;
  }
  return bundlePromise;
}

/**
 * Preload the renderer bundle without blocking.
 * Call early (e.g., at app startup) so bundle is ready when cells render.
 */
export function preloadRendererBundle(): void {
  loadRendererBundle();
}
