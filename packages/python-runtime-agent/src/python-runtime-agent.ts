import {
  Environment,
  PipEnvironmentManager,
} from './pip-environment-manager.ts';
import requirements from "./requirements.txt" with { type: "text" };
import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import { createLogger } from "@runt/lib";
import spawnteract from "spawnteract";

export class PythonRuntimeAgent {
  private envManager = new PipEnvironmentManager();
  private environment: Environment | null = null;
  private agent: RuntimeAgent;
  private logger = createLogger("python-runtime-agent");
  private kernel: any = null; // spawnteract kernel handle

  constructor(args: string[] = Deno.args) {
    const config = createRuntimeConfig(args, {
      runtimeType: "python3-subprocess",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
    });
    this.agent = new RuntimeAgent(config, config.capabilities, {
      onStartup: this.onStartup.bind(this),
      // onShutdown can be extended if needed
    });
    this.agent.onExecution(this.executeCell.bind(this));
  }

  private async onStartup(): Promise<void> {
    this.logger.info("PythonRuntimeAgent onStartup: creating environment");
    this.environment = await this.envManager.createEnvironment({
      specs: requirements,
    });
    const envPath = this.envManager.getEnvironmentPath(this.environment);
    this.logger.info(`Environment created at ${envPath}`);

    this.logger.info("Launching ipykernel with spawnteract");
    this.kernel = await spawnteract.launch("python3", {
      cwd: envPath,
      env: {
        ...Deno.env.toObject(),
        VIRTUAL_ENV: envPath,
        PATH: `${envPath}/bin:${Deno.env.get("PATH") ?? ""}`,
      },
      kernelArgs: [
        "-m", "ipykernel_launcher", "-f", "{connection_file}"
      ],
    });
    this.logger.info("ipykernel launched");
    // TODO: handle kernel shutdown/cleanup
  }

  private async executeCell(context: any): Promise<{ success: boolean; error?: string }> {
    const { cell, stdout, stderr, result, error, abortSignal } = context;
    const code = cell.source?.trim() || "";
    if (!code) return { success: true };
    if (!this.kernel) {
      stderr("Kernel not started\n");
      return { success: false, error: "Kernel not started" };
    }
    // Only support code cells for now
    if (cell.cellType !== "code") {
      stderr("Only code cells are supported\n");
      return { success: false, error: "Only code cells are supported" };
    }
    try {
      const msg = await this.kernel.execute(code);
      // Stream outputs as they arrive
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

  async start(): Promise<void> {
    await this.agent.start();
  }

  async keepAlive(): Promise<void> {
    await this.agent.keepAlive();
  }

  async shutdown(): Promise<void> {
    this.logger.info('PythonRuntimeAgent shutdown (tearing down environment)');
    // TODO: shutdown/cleanup kernel process
    if (this.environment) {
      await this.envManager.deleteEnvironment(this.environment);
      this.environment = null;
      this.logger.info('Environment deleted');
    }
    await this.agent.shutdown();
  }
}
