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
export {
  getBootstrapPackages,
  getCacheConfig,
  getCacheDir,
  getEssentialPackages,
  getOnDemandPackages,
  getPreloadPackages,
  isFirstRun,
} from "./cache-utils.ts";

// Run the agent if this file is executed directly
if (import.meta.main) {
  const agent = new PyodideRuntimeAgent();
  await runner(agent, "PyoRunt");
}
