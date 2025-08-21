import { PythonRuntimeAgent } from "./src/python-runtime-agent.ts";
import { runner } from "@runt/lib";
export { PythonRuntimeAgent };

if (import.meta.main) {
  const agent = await PythonRuntimeAgent.create();
  await runner(agent, "PyRunt");
}
