// Dynamic example tests
//
// This test automatically discovers and validates all TypeScript examples
// in the examples directory without needing manual maintenance.

import { assertEquals, assertExists } from "jsr:@std/assert";

Deno.test("Example Files", async (t) => {
  await t.step(
    "should discover and validate all TypeScript examples",
    async () => {
      const examplesDir = new URL("../examples/", import.meta.url);

      const exampleFiles: string[] = [];

      try {
        for await (const entry of Deno.readDir(examplesDir)) {
          if (
            entry.isFile && entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts")
          ) {
            exampleFiles.push(entry.name);
          }
        }
      } catch (error) {
        throw new Error(`Failed to read examples directory: ${error}`);
      }

      // Ensure we found some examples
      assertEquals(
        exampleFiles.length > 0,
        true,
        "No TypeScript example files found",
      );

      // Test each example file
      for (const filename of exampleFiles) {
        // Check file exists and is readable
        try {
          const filePath = new URL(`../examples/${filename}`, import.meta.url);
          const fileInfo = await Deno.stat(filePath);
          assertEquals(fileInfo.isFile, true, `${filename} should be a file`);
        } catch (error) {
          throw new Error(`Failed to stat ${filename}: ${error}`);
        }

        // Try to import the module (but don't execute if it's a main script)
        if (!filename.includes("agent")) {
          // Only import non-agent files since agent files run immediately
          try {
            const module = await import(`../examples/${filename}`);
            assertExists(module, `${filename} should export a module`);
          } catch (error) {
            throw new Error(`Failed to import ${filename}: ${error}`);
          }
        }
      }

      // Only show validation message in verbose mode
      if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
        console.log(
          `✅ Validated ${exampleFiles.length} example files: ${
            exampleFiles.join(", ")
          }`,
        );
      }
    },
  );
});

Deno.test("Specific Example Exports", async (t) => {
  await t.step(
    "should export expected classes from enhanced-output-example",
    async () => {
      const module = await import("../examples/enhanced-output-example.ts");

      assertExists(module.ExamplePythonRuntime);
      assertEquals(typeof module.ExamplePythonRuntime, "function");

      assertExists(module.ComparisonExample);
      assertEquals(typeof module.ComparisonExample, "function");

      assertExists(module.runExample);
      assertEquals(typeof module.runExample, "function");
    },
  );
});
