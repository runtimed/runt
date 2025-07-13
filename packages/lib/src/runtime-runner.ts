import { createLogger } from "./logging.ts";
import type { RuntimeAgent } from "./runtime-agent.ts";

/**
 * Helper function to implement a CLI entrypoint for python agents
 * Each agent implementation just needs to call main() with their RuntimeAgent
 */
export async function runner(agent: RuntimeAgent) {
  const logger = createLogger("pyrunt");

  try {
    await agent.start();
    logger.info("PyRunt started");

    await agent.keepAlive();
  } catch (error) {
    logger.error("Failed to start PyRunt", error);
    Deno.exit(1);
  } finally {
    await agent.shutdown();
  }
}
