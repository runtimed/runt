import {
  createLogger,
  createRuntimeConfig,
  RuntimeAgent,
  type RuntimeAgentOptions,
  type RuntimeConfig,
} from "@runt/lib";
import { PythonWorker } from "./python-worker.ts";

export class PythonRuntimeAgent extends RuntimeAgent {
  private worker: PythonWorker | null = null;
  private logger = createLogger("python-runtime-agent");
  constructor(args: string[] = Deno.args) {
    let config: RuntimeConfig;
    try {
      config = createRuntimeConfig(args, {
        runtimeType: "python3",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: false,
          availableAiModels: [],
        },
      });
    } catch (error) {
      // Configuration errors should still go to console for CLI usability
      console.error("❌ Configuration Error:");
      console.error(error instanceof Error ? error.message : String(error));
      console.error("\nExample usage:");
      console.error(
        '  deno run --allow-all "jsr:@runt/python-runtime-agent" --notebook my-notebook --auth-token your-token',
      );
      console.error("\nOr set environment variables in .env:");
      console.error("  NOTEBOOK_ID=my-notebook");
      console.error("  AUTH_TOKEN=your-token");
      console.error("\nOr install globally:");
      console.error(
        "  deno install -gf --allow-all jsr:@runt/python-runtime-agent",
      );
      console.error("  pyrunt --notebook my-notebook --auth-token your-token");
      Deno.exit(1);
    }

    super(config, config.capabilities, {
      onStartup: (environmentOptions) => this.onStartup(environmentOptions),
      onShutdown: () => this.onShutdown(),
    });
  }

  private async onStartup(
    options: RuntimeAgentOptions["environmentOptions"],
  ): Promise<void> {
    if (options.runtimeEnvExternallyManaged) {
      const pythonPath = options.runtimePythonPath ?? "python3";
      this.worker = new PythonWorker(pythonPath);
      try {
        await this.worker.start();
      } catch (error) {
        this.logger.error("Failed to start PythonWorker", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else {
      throw new Error("Not yet implemented");
    }
  }

  private async onShutdown(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.shutdown();
        this.logger.info("PythonWorker shutdown complete");
      } catch (error) {
        this.logger.error("Error shutting down PythonWorker", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.worker = null;
    }
  }
}
