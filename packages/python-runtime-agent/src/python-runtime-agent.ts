import {
  createRuntimeConfig,
  RuntimeAgent,
  type RuntimeConfig,
} from "@runt/lib";

export class PythonRuntimeAgent extends RuntimeAgent {
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
        '  deno run --allow-all "jsr:@runt/python-runtime-agent" --notebook my-notebook --auth-token your-runt-api-key',
      );
      console.error("\nOr set environment variables in .env:");
      console.error("  NOTEBOOK_ID=my-notebook");
      console.error("  RUNT_API_KEY=your-runt-api-key");
      console.error("\nOr install globally:");
      console.error(
        "  deno install -gf --allow-all jsr:@runt/python-runtime-agent",
      );
      console.error("  pyrunt --notebook my-notebook --auth-token your-token");
      Deno.exit(1);
    }

    super(config, config.capabilities, {});
  }
}
