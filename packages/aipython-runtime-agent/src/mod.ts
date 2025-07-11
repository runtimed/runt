// AIPython Runtime Agent - AI-powered Python execution simulation
//
// This package provides a runtime agent that uses AI to simulate IPython
// execution by providing the AI with tools connected to execution context
// output methods.

export { AIPythonAgent } from "./aipython-agent.ts";

// Main execution when run as a script
if (import.meta.main) {
  const { AIPythonAgent } = await import("./aipython-agent.ts");

  const agent = new AIPythonAgent();

  try {
    await agent.start();
    console.log("🧠 AIPython Agent Started!");
    console.log("💡 AI simulating Python execution with tool calling");
    console.log("🐍 Ready to execute Python code via AI simulation");

    await agent.keepAlive();
  } catch (error) {
    console.error("❌ Failed to start AIPython agent:", error);
    Deno.exit(1);
  }
}
