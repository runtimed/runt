import type { Store } from "npm:@livestore/livestore";
import { RuntimeAgent } from "@runt/runtime-core";
import type {
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "@runt/runtime-core";

/**
 * Browser-specific runtime agent options
 */
export interface BrowserRuntimeAgentOptions
  extends Partial<RuntimeAgentOptions> {
  /** Custom cleanup handlers to run on shutdown */
  onCleanup?: Array<() => void>;
}

/**
 * Create a browser-compatible runtime agent that integrates with an existing LiveStore.
 *
 * Unlike server-side runtime agents, this doesn't create its own store but uses
 * the one provided by the React application for seamless integration.
 *
 * @param store - LiveStore instance from React app
 * @param capabilities - What the runtime can execute
 * @param options - Browser-specific configuration options
 * @returns Configured RuntimeAgent ready for browser use
 *
 * @example
 * ```typescript
 * const { store } = useStore(); // From React app
 * const { user } = useAuthenticatedUser();
 *
 * const agent = createBrowserRuntimeAgent(store, {
 *   canExecuteCode: true,
 *   canExecuteSql: false,
 *   canExecuteAi: false,
 * }, {
 *   runtimeId: 'browser-echo',
 *   runtimeType: 'echo',
 *   clientId: user.sub, // CRITICAL: use authenticated user ID
 * });
 *
 * // Set up echo handler
 * agent.onExecution(async (context) => {
 *   await context.result({ 'text/plain': `Echo: ${context.cell.source}` });
 *   return { success: true };
 * });
 *
 * await agent.start();
 * ```
 */
export function createBrowserRuntimeAgent(
  // deno-lint-ignore no-explicit-any
  store: Store<any>,
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
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
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
