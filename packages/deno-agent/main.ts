// %%
import { Sandbox } from "@deno/sandbox";
import "@std/dotenv/load";

// %%
await using sandbox = await Sandbox.create();

// %%
const result = await sandbox.eval(`1 + 2`);
console.log("result:", result);

// %%
let repl = await sandbox.repl();

// %%
await repl.eval(`5`);

// %%
const result2 = await sandbox.eval(`5`);
console.log("result:", result2);

// %%
await sandbox.close();
