/**
 * Safely unregister a Tauri event listener.
 *
 * Catches errors that occur if the Tauri event plugin is destroyed
 * before the cleanup runs (e.g., during app shutdown).
 *
 * In Tauri API 2.10+, the unlisten function makes a synchronous call to
 * `window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener()` which
 * throws if the plugin internals have been torn down. This wrapper
 * silently catches those errors since if the plugin is gone, the
 * listener is already cleaned up.
 */
export function safeUnlisten(
  unlistenPromise: Promise<() => void | Promise<void>>,
): void {
  unlistenPromise.then((fn) => fn()).catch(() => {});
}
