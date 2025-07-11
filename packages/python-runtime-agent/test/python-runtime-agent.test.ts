import { PythonRuntimeAgent } from "../src/python-runtime-agent.ts";

Deno.test("PythonRuntimeAgent can be instantiated", () => {
  const agent = new PythonRuntimeAgent();
  if (!(agent instanceof PythonRuntimeAgent)) {
    throw new Error("agent is not an instance of PythonRuntimeAgent");
  }
});
