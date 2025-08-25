import { PythonRuntimeAgent } from "./src/python-runtime-agent.ts";
import { createLogger } from "@runt/lib";
export { PythonRuntimeAgent };

if (import.meta.main) {
  const name = "PyRunt";

  const logger = createLogger(name);
  const agent = new PythonRuntimeAgent();

  logger.info("Starting Agent");

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
    logger.error(`${name} failed to start`, error);
    Deno.exit(1);
  }

  agent.shutdown().catch((error) => {
    logger.error(`${name} failed to shutdown`, error);
    Deno.exit(1);
  });
  Deno.exit(0);
}
