// Browser-compatible runtime agent implementation
//
// This module is designed to work in browser environments and should not
// use Deno-specific or Node.js-specific APIs. The underlying runtime-core
// package has been made cross-platform to support browser usage.

import type { Store } from "npm:@livestore/livestore";
import { makeSchema, State } from "npm:@livestore/livestore";
import { events, materializers, tables } from "@runt/schema";
import { RuntimeAgent } from "@runt/runtime-core";
import type {
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "@runt/runtime-core";

// Create schema for proper typing
const schema = makeSchema({
  events,
  state: State.SQLite.makeState({ tables, materializers }),
});

/**
 * Browser-specific runtime agent options
 */
export interface BrowserRuntimeAgentOptions
  extends Partial<RuntimeAgentOptions> {
  /** Custom cleanup handlers to run on shutdown */
  onCleanup?: Array<() => void>;
}

/**
 * Create a browser-compatible runtime agent that uses an existing LiveStore instance.
 *
 * **CRITICAL**: This function expects a LiveStore instance that's already configured
 * by your React application (via LiveStoreProvider). Do NOT create a new store -
 * use the existing one to ensure proper state synchronization between the runtime
 * agent and your React UI components.
 *
 * @param store - Existing LiveStore instance from React context (via useStore())
 * @param capabilities - What the runtime can execute
 * @param options - Browser-specific configuration options
 * @returns Configured RuntimeAgent that shares state with React UI
 *
 * @example React Integration
 * ```typescript
 * // In your React component or custom hook:
 * import { useStore } from '@livestore/react';
 * import { useAuthenticatedUser } from '../auth/AuthContext';
 *
 * function useBrowserRuntime() {
 *   const { store } = useStore(); // Get existing store - DON'T create new one!
 *   const { user } = useAuthenticatedUser();
 *
 *   const startRuntime = useCallback(async () => {
 *     const agent = createBrowserRuntimeAgent(store, {
 *       canExecuteCode: true,
 *       canExecuteSql: false,
 *       canExecuteAi: false,
 *     }, {
 *       runtimeId: 'browser-runtime',
 *       runtimeType: 'echo', // or 'python' for Pyodide
 *       clientId: user.sub, // MUST match LiveStore adapter clientId
 *     });
 *
 *     agent.onExecution(async (context) => {
 *       await context.result({ 'text/plain': `Echo: ${context.cell.source}` });
 *       return { success: true };
 *     });
 *
 *     await agent.start();
 *     return agent;
 *   }, [store, user]);
 *
 *   return { startRuntime };
 * }
 * ```
 */
export function createBrowserRuntimeAgent(
  store: Store<typeof schema>,
  capabilities: RuntimeCapabilities,
  options?: BrowserRuntimeAgentOptions,
): RuntimeAgent {
  // Generate defaults suitable for browser environment
  const runtimeOptions: RuntimeAgentOptions = {
    runtimeId: options?.runtimeId ||
      `browser-${crypto.randomUUID().slice(0, 8)}`,
    runtimeType: options?.runtimeType || "echo",
    clientId: options?.clientId || (() => {
      throw new Error(
        "clientId is required for browser runtime agents. " +
          "This should be the authenticated user's ID from your auth system.",
      );
    })(),
    sessionId: options?.sessionId || crypto.randomUUID(),
    ...options,
  };

  // Create the runtime agent with the provided store
  const agent = new RuntimeAgent(store, capabilities, runtimeOptions);

  // Set up browser-specific lifecycle management
  setupBrowserLifecycle(agent, options?.onCleanup);

  return agent;
}

/**
 * Set up browser lifecycle management for the runtime agent.
 *
 * This handles cleanup when the user navigates away or closes the tab,
 * ensuring the runtime session is properly terminated.
 */
function setupBrowserLifecycle(
  agent: RuntimeAgent,
  customCleanup?: Array<() => void>,
) {
  const cleanup = () => {
    // Run custom cleanup handlers first
    customCleanup?.forEach((handler) => {
      try {
        handler();
      } catch (error) {
        console.warn("Browser runtime cleanup handler failed:", error);
      }
    });

    // Shutdown the agent
    agent.shutdown().catch((error) => {
      console.warn("Browser runtime agent shutdown failed:", error);
    });
  };

  // Clean up on page unload
  globalThis.addEventListener("beforeunload", cleanup);

  // Also clean up on visibility change (when tab becomes hidden)
  // This helps with mobile browsers that may not fire beforeunload
  if (typeof globalThis !== "undefined" && "document" in globalThis) {
    interface BrowserDocument {
      addEventListener: (event: string, callback: () => void) => void;
      visibilityState: string;
    }
    const doc =
      (globalThis as typeof globalThis & { document: BrowserDocument })
        .document;
    doc.addEventListener("visibilitychange", () => {
      if (doc.visibilityState === "hidden") {
        cleanup();
      }
    });
  }

  // Store cleanup function on the agent for manual cleanup if needed
  (agent as unknown as { _browserCleanup: () => void })._browserCleanup =
    cleanup;
}

/**
 * Manually clean up a browser runtime agent.
 *
 * This is useful if you need to shutdown the agent before page unload,
 * or if you're managing the lifecycle manually.
 */
export function cleanupBrowserRuntimeAgent(agent: RuntimeAgent) {
  const cleanup =
    (agent as unknown as { _browserCleanup?: () => void })._browserCleanup;
  if (cleanup && typeof cleanup === "function") {
    cleanup();
  }
}
