import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";

export interface PythonAgentOptions {
  unused?: string; // TODO: remove
}

export class PythonRuntimeAgent {
  private agent: RuntimeAgent;
  public config: ReturnType<typeof createRuntimeConfig>;
  private options: PythonAgentOptions;

  constructor(args: string[] = [], options: PythonAgentOptions = {}) {
    this.config = createRuntimeConfig(args, {
      kernelType: "python3-subprocess",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: true,
      },
    });
    this.options = options;
    this.agent = new RuntimeAgent(this.config, this.config.capabilities, {});
  }

  async start(): Promise<void> {
    await this.agent.start();
  }

  async shutdown(): Promise<void> {
    await this.agent.shutdown();
  }

  async keepAlive(): Promise<void> {
    await this.agent.keepAlive();
  }
}
