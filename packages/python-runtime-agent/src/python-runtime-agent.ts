import { RuntimeAgent, RuntimeConfig } from "@runt/lib";
import { makeInMemoryAdapter } from "npm:@livestore/adapter-web";

export class PythonRuntimeAgent extends RuntimeAgent {
  constructor(_args: string[] = Deno.args) {
    // Create dummy config since this is just a stub
    const dummyConfig = new RuntimeConfig({
      runtimeId: "python-stub",
      runtimeType: "python3",
      syncUrl: "ws://localhost:8080",
      authToken: "dummy",
      notebookId: "dummy",
      capabilities: {
        canExecuteCode: false,
        canExecuteSql: false,
        canExecuteAi: false,
      },
      clientId: "dummy",
      adapter: makeInMemoryAdapter({}),
    });

    super(dummyConfig, dummyConfig.capabilities, {});

    console.error("❌ Not Implemented:");
    console.error("The Python runtime agent is not yet implemented.");
    console.error("\nUse the Pyodide runtime agent instead:");
    console.error('  deno run --allow-all "jsr:@runt/pyodide-runtime-agent"');
    console.error("\nOr install globally:");
    console.error(
      "  deno install -gf --allow-all jsr:@runt/pyodide-runtime-agent",
    );
    console.error("  pyorunt --notebook my-notebook --auth-token your-token");

    // Don't exit during tests
    const isTestEnvironment = Deno.env.get("DENO_TESTING") === "true" ||
      Deno.args.some((arg) => arg.includes("test")) ||
      Deno.args.some((arg) => arg.endsWith(".test.ts")) ||
      (typeof Deno !== "undefined" && Deno.mainModule &&
        Deno.mainModule.includes(".test.ts"));

    if (!isTestEnvironment) {
      Deno.exit(1);
    }
  }
}
