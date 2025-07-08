import { PythonRuntimeAgent } from "./python-agent.ts";
export { PythonRuntimeAgent };

if (import.meta.main) {
  const agent = new PythonRuntimeAgent(Deno.args);
  agent.start().then(() => agent.keepAlive());
}
