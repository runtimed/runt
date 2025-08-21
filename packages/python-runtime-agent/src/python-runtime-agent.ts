import {
  createRuntimeConfig,
  createStoreFromConfig,
  RuntimeAgent,
  type RuntimeConfig,
  type RuntimeSchema,
} from "@runt/lib";
import type { Store } from "npm:@livestore/livestore";

export class PythonRuntimeAgent extends RuntimeAgent {
  public config: RuntimeConfig;
  public override store: Store<RuntimeSchema>;

  private constructor(
    store: Store<RuntimeSchema>,
    config: RuntimeConfig,
  ) {
    super(store, config.capabilities, {
      runtimeId: config.runtimeId,
      runtimeType: config.runtimeType,
      clientId: config.runtimeId,
      sessionId: config.sessionId,
    });
    this.config = config;
    this.store = store;
  }

  static async create(args: string[] = Deno.args): Promise<PythonRuntimeAgent> {
    let config: RuntimeConfig;
    try {
      config = createRuntimeConfig(args, {
        runtimeType: "python3",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: false,
        },
      });
    } catch (error) {
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

    const store = await createStoreFromConfig(config);
    return new PythonRuntimeAgent(store, config);
  }
}
