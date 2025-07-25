import { assertEquals } from "@std/assert";
import { RuntimeAgent } from "./runtime-agent.ts";
import { RuntimeConfig } from "./config.ts";
import type { InlineContainer, MediaContainer } from "@runt/schema";
import type { RuntimeCapabilities } from "./types.ts";
import { queryDb, Schema, sql } from "npm:@livestore/livestore";
import { assert } from "@std/assert/assert";

Deno.test("RuntimeAgent Text Representations for Artifacts", async (t) => {
  await t.step(
    "should not override existing text/plain representations",
    () => {
      const capabilities: RuntimeCapabilities = {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      };

      const config = new RuntimeConfig({
        runtimeId: "test-runtime",
        runtimeType: "test",
        notebookId: "test-notebook",
        syncUrl: "ws://localhost:8080",
        authToken: "test-token",
        capabilities,
        environmentOptions: {},
      });

      const agent = new RuntimeAgent(config, capabilities);

      // Create representations with existing text/plain
      const representations: Record<string, MediaContainer> = {
        "image/png": {
          type: "artifact",
          artifactId: "test-artifact-123",
          metadata: { originalSizeBytes: 50000 },
        },
        "text/plain": {
          type: "inline",
          data: "<Axes: >",
          metadata: {},
        },
      };

      agent.onExecution(async (execCtx) => {
        await execCtx.display(representations);
        return { success: true };
      });

      const results = agent.store.query(queryDb(
        {
          query:
            sql`SELECT id, cellid, json_extract(representations, '$."image/png".type') as "image/png:type", json_extract(representations, '$."image/png".artifactId') as "image/png:artifactId", json_extract(representations, '$."image/png".metadata.originalSizeBytes') as "image/png:originalSizeBytes", json_extract(representations, '$."text/plain".type') as "text/plain:type", json_extract(representations, '$."text/plain".data') as "text/plain:data", json_extract(representations, '$."text/markdown".type') as "text/markdown:type", json_extract(representations, '$."text/markdown".data') as "text/markdown:data" FROM outputs WHERE mimetype='image/png';`,
          schema: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              cellid: Schema.String,
              "image/png:type": Schema.optional(Schema.String),
              "image/png:artifactId": Schema.optional(Schema.String),
              "image/png:originalSizeBytes": Schema.optional(Schema.Number),
              "text/plain:type": Schema.optional(Schema.String),
              "text/plain:data": Schema.optional(Schema.String),
              "text/markdown:type": Schema.optional(Schema.String),
              "text/markdown:data": Schema.optional(Schema.String),
            }),
          ),
        },
      ));

      assertEquals(results.length, 1);

      assertEquals(results[0]["image/png:type"], "artifact");
      assertEquals(results[0]["image/png:artifactId"], "test-artifact-123");
      assertEquals(results[0]["image/png:originalSizeBytes"], 50000);
      assertEquals(results[0]["text/plain:type"], "inline");
      assertEquals(results[0]["text/plain:data"], "<Axes: >");
      assertEquals(results[0]["text/markdown:type"], "inline");
      assertEquals(results[0]["text/markdown:data"], "<Axes: >");
    },
  );
});
