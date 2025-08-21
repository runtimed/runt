import { createLogger } from "@runt/runtime-core";
import type { RuntimeAgent } from "@runt/runtime-core";

/**
 * Helper function to implement a CLI entrypoint for python agents
 * Each agent implementation just needs to call main() with their RuntimeAgent
 */
export async function runner(agent: RuntimeAgent, name: string) {
  const logger = createLogger(name);

  try {
    await agent.start();
    logger.info(`${name} started`, {
      runtimeId: agent.options.runtimeId,
      runtimeType: agent.options.runtimeType,
      sessionId: agent.sessionId,
    });

    await agent.keepAlive();
  } catch (error) {
    logger.error(`Failed to start ${name}`, error);
    Deno.exit(1);
  } finally {
    await agent.shutdown();
  }
}
