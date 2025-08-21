import { createLogger } from "./logging.ts";
import type { RuntimeAgent } from "./runtime-agent.ts";

/**
 * Helper function to implement a CLI entrypoint for python agents
 * Each agent implementation just needs to call main() with their RuntimeAgent
 */
export async function runner(agent: RuntimeAgent, name: string) {
  const logger = createLogger(name);

  try {
    await agent.start();
    logger.info(`${name} started`, {
      runtimeId: agent.config.runtimeId,
      runtimeType: agent.config.runtimeType,
      notebookId: agent.config.notebookId,
      sessionId: agent.config.sessionId,
      syncUrl: agent.config.syncUrl,
    });

    await agent.keepAlive();
  } catch (error) {
    logger.error(`Failed to start ${name}`, error);
    Deno.exit(1);
  } finally {
    await agent.shutdown();
  }
}
