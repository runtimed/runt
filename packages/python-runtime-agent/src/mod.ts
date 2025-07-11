import { PythonRuntimeAgent } from './python-runtime-agent.ts';
import { createLogger } from '@runt/lib';

async function main() {
  const agent = new PythonRuntimeAgent();
  const logger = createLogger('python-runtime-agent');

  try {
    await agent.start();
    logger.info('PythonRuntimeAgent started');
    await agent.keepAlive();
  } catch (error) {
    logger.error('Failed to start PythonRuntimeAgent', error);
    Deno.exit(1);
  } finally {
    await agent.shutdown();
  }
}

if (import.meta.main) {
  await main();
}
