// %%
import { Sandbox } from "@deno/sandbox";
import "@std/dotenv/load";
await using sandbox = await Sandbox.create();

// %%
let repl = await sandbox.repl();

// %%
await repl.eval(`var x = 2`);

// %%
await repl.eval(`x*3`);

// %%
await sandbox.close();
