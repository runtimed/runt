import {
  Environment,
  PipEnvironmentManager,
} from './pip-environment-manager.ts';
import type { EnvironmentManager } from './environment-manager.ts';
import requirements from "./requirements.txt" with { type: "text" };
import type { RuntimeAgentStartupConfig } from "@runt/lib/types";
import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import { createLogger } from "@runt/lib";
import spawnteract from "spawnteract";
import { executeAI, gatherNotebookContext } from "@runt/ai";
import type { ExecutionContext } from "@runt/lib";

export class PythonRuntimeAgent {
  private envManager: EnvironmentManager = new PipEnvironmentManager();
  private environment: Environment | null = null;
  private agent: RuntimeAgent;
  private logger = createLogger("python-runtime-agent");
  private kernel: any = null; // spawnteract kernel handle
  private currentAIExecution: { cellId: string; abortController: AbortController } | null = null;

  constructor(args: string[] = Deno.args) {
    const config = createRuntimeConfig(args, {
      runtimeType: "python3-subprocess",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: true,
      },
    });
    this.agent = new RuntimeAgent(config, config.capabilities, {
      onStartup: this.onStartup.bind(this),
    });
    this.agent.onExecution(this.executeCell.bind(this));
    this.agent.onCancellation(this.handleCancellation.bind(this));
  }

  get store() {
    return this.agent.liveStore;
  }

  private async onStartup(startupConfig: RuntimeAgentStartupConfig): Promise<void> {
    const environmentPath = startupConfig.runtimeEnvPath;
    const specs = startupConfig.runtimeSpecs ?? requirements;
    let envPath: string;
    if (typeof environmentPath === 'string' && environmentPath.length > 0) {
      this.logger.info(`PythonRuntimeAgent onStartup: loading environment at ${environmentPath}`);
      this.environment = await this.envManager.loadEnvironment(environmentPath);
      this.logger.info(`Environment loaded at ${environmentPath}`);
      if (specs) {
        await this.envManager.updateEnvironment(this.environment, specs);
        this.logger.info('Environment updated with provided specs');
      }
      envPath = this.envManager.getEnvironmentPath(this.environment);
    } else {
      this.logger.info("PythonRuntimeAgent onStartup: creating environment");
      this.environment = await this.envManager.createEnvironment({
        specs,
      });
      envPath = this.envManager.getEnvironmentPath(this.environment);
      this.logger.info(`Environment created at ${envPath}`);
    }

    // Launch ipykernel using spawnteract
    this.logger.info("Launching ipykernel with spawnteract");
    this.kernel = await spawnteract.launch("python3", {
      cwd: envPath,
      env: {
        ...Deno.env.toObject(),
        PATH: `${envPath}/bin:${Deno.env.get("PATH") ?? ""}`,
      },
      kernelArgs: [
        "-m", "ipykernel_launcher", "-f", "{connection_file}"
      ],
    });
    this.logger.info("ipykernel launched");
  }

  private async executeCell(context: ExecutionContext): Promise<{ success: boolean; error?: string }> {
    const { cell, stdout, stderr, result, error, abortSignal } = context;
    const code = cell.source?.trim() || "";
    if (!code) return { success: true };
    if (!this.kernel) {
      stderr("Kernel not started\n");
      return { success: false, error: "Kernel not started" };
    }
    if (cell.cellType === "ai") {
      // AI cell: use @runt/ai
      const notebookContext = gatherNotebookContext(this.store, cell);
      const aiAbortController = new AbortController();
      this.currentAIExecution = {
        cellId: cell.id,
        abortController: aiAbortController,
      };
      if (abortSignal.aborted) {
        aiAbortController.abort();
      } else {
        abortSignal.addEventListener("abort", () => {
          aiAbortController.abort();
        });
      }
      const aiContext = { ...context, abortSignal: aiAbortController.signal };
      try {
        return await executeAI(
          aiContext,
          notebookContext,
          this.logger,
          this.store,
          context.sessionId,
        );
      } finally {
        this.currentAIExecution = null;
      }
    }
    if (cell.cellType !== "code") {
      stderr("Only code and AI cells are supported\n");
      return { success: false, error: "Only code and AI cells are supported" };
    }
    try {
      const msg = await this.kernel.execute(code);
      for await (const output of msg) {
        if (output.output_type === "stream") {
          if (output.name === "stdout") stdout(output.text);
          else if (output.name === "stderr") stderr(output.text);
        } else if (output.output_type === "error") {
          error(output.ename, output.evalue, output.traceback || []);
        } else if (output.output_type === "execute_result" || output.output_type === "display_data") {
          result(output.data, output.metadata);
        }
        // TODO: handle clear_output, update_display_data, etc.
      }
      return { success: true };
    } catch (err) {
      stderr(`Kernel execution error: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private handleCancellation(queueId: string, cellId: string, reason: string): void {
    this.logger.info("Python execution cancellation", {
      queueId,
      cellId,
      reason,
    });
    if (this.currentAIExecution && this.currentAIExecution.cellId === cellId) {
      this.logger.info("Cancelling AI execution", { cellId });
      this.currentAIExecution.abortController.abort();
      this.currentAIExecution = null;
      return;
    }
    // Interrupt the ipykernel for code cell cancellation
    if (this.kernel && this.kernel.spawn && typeof this.kernel.spawn.kill === "function") {
      try {
        this.logger.info("Sending SIGINT to ipykernel process");
        this.kernel.spawn.kill("SIGINT");
      } catch (err) {
        this.logger.error("Failed to send SIGINT to kernel process", err);
      }
    }
  }

  async start(): Promise<void> {
    await this.agent.start();
  }

  async keepAlive(): Promise<void> {
    await this.agent.keepAlive();
  }

  async shutdown(): Promise<void> {
    this.logger.info('PythonRuntimeAgent shutdown (tearing down environment)');
    // Shutdown/cleanup kernel process
    if (this.kernel && this.kernel.spawn && typeof this.kernel.spawn.kill === "function") {
      try {
        this.logger.info("Killing ipykernel process");
        this.kernel.spawn.kill();
      } catch (err) {
        this.logger.error("Failed to kill kernel process", err);
      }
      this.kernel = null;
    }
    if (this.environment) {
      await this.envManager.deleteEnvironment(this.environment);
      this.environment = null;
      this.logger.info('Environment deleted');
    }
    await this.agent.shutdown();
  }
}
