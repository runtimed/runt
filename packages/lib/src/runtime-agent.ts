// DenoRuntimeAgent - Deno-specific implementation of RuntimeAgent

import { RuntimeAgent, RuntimeConfig } from "@runt/lib-web";
import type {
  RuntimeAgentEventHandlers,
  RuntimeCapabilities,
} from "@runt/lib-web";
import { createLogger } from "@runt/lib-web";

/**
 * Deno-specific implementation of RuntimeAgent
 */
export class DenoRuntimeAgent extends RuntimeAgent {
  private signalHandlers = new Map<string, () => void>();

  constructor(
    config: RuntimeConfig,
    capabilities: RuntimeCapabilities,
    handlers: RuntimeAgentEventHandlers = {},
  ) {
    // Create a config with Deno-specific signal handlers
    const denoConfig = new RuntimeConfig({
      ...config,
      signalHandlers: {
        setup: (shutdown: () => void) => {
          // Store signal handlers for cleanup
          this.signalHandlers.set("SIGINT", shutdown);
          this.signalHandlers.set("SIGTERM", shutdown);

          Deno.addSignalListener("SIGINT" as Deno.Signal, shutdown);
          Deno.addSignalListener("SIGTERM" as Deno.Signal, shutdown);
        },
        cleanup: () => {
          for (const [signal, handler] of this.signalHandlers) {
            try {
              Deno.removeSignalListener(signal as Deno.Signal, handler);
            } catch (error) {
              // Ignore errors during cleanup
              const cleanupLogger = createLogger(`${config.runtimeType}-agent`);
              cleanupLogger.debug("Error removing signal listener", {
                signal,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          this.signalHandlers.clear();
        },
      },
    });

    super(denoConfig, capabilities, handlers);
  }
}
