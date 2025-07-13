import { PythonRuntimeAgent } from "./src/python-runtime-agent.ts";
import { runner } from "@runt/lib";
export { PythonRuntimeAgent };

if (import.meta.main) {
  const agent = new PythonRuntimeAgent();
  await runner(agent, "PyRunt");
}
