#!/usr/bin/env -S deno run --allow-net --allow-env

// AIPython CLI - AI-powered Python execution simulation
//
// This executable starts an AIPython runtime agent that connects to Anode
// notebooks and simulates Python execution using AI with proper tool calling.

import { AIPythonAgent } from "../src/aipython-agent.ts";

async function main() {
  // Show banner
  console.log("🧠 AIPython - AI-powered Python execution simulation");
  console.log("🐍 Simulates IPython using AI with real output methods");
  console.log("");

  // Check for required environment variables
  if (!Deno.env.get("OPENAI_API_KEY")) {
    console.error("❌ Missing required environment variable: OPENAI_API_KEY");
    console.error("");
    console.error("Set your OpenAI API key:");
    console.error("  export OPENAI_API_KEY=your-api-key-here");
    console.error("");
    console.error("Or add it to your .env file:");
    console.error("  OPENAI_API_KEY=your-api-key-here");
    Deno.exit(1);
  }

  const agent = new AIPythonAgent();

  try {
    await agent.start();
    console.log("✅ AIPython agent started successfully!");
    console.log("");
    console.log(
      "🔗 Connected to notebook - ready to simulate Python execution",
    );
    console.log("💡 The AI will use proper IPython tools for output");
    console.log("");
    console.log("Try executing Python code in your notebook:");
    console.log("  • 2 + 3");
    console.log("  • print('Hello, World!')");
    console.log("  • import numpy as np");
    console.log("  • [i**2 for i in range(5)]");
    console.log("");

    await agent.keepAlive();
  } catch (error) {
    console.error("❌ Failed to start AIPython agent:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
