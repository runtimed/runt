#!/usr/bin/env -S deno run --allow-all --unstable-broadcast-channel
/**
 * PyoRunt - Python Runtime Agent
 *
 * Main executable entry point for the Pyodide runtime agent.
 * This file serves as both the library entry point and the executable.
 */

import { PyodideRuntimeAgent } from "./pyodide-agent.ts";
import { runner } from "@runt/lib";

export { PyodideRuntimeAgent } from "./pyodide-agent.ts";

// Lots of common bugs are caused by not setting the LIVESTORE_SYNC_URL variable
console.log(
  "Using LIVESTORE_SYNC_URL:",
  Deno.env.toObject().LIVESTORE_SYNC_URL,
);

// Run the agent if this file is executed directly
if (import.meta.main) {
  const agent = new PyodideRuntimeAgent();
  await runner(agent, "PyoRunt");
}
