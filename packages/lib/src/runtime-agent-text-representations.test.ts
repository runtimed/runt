import { assertEquals } from "@std/assert";
import { RuntimeAgent } from "./runtime-agent.ts";
import { RuntimeConfig } from "./config.ts";
import { events, type MediaContainer } from "@runt/schema";
import type {
  IArtifactClient,
  RawOutputData,
  RuntimeCapabilities,
} from "./types.ts";
import { queryDb, Schema, sql } from "npm:@livestore/livestore";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tests for RuntimeAgent text representation generation behavior:
 * 1. Small inline images don't get automatic text representations
 * 2. Large images attempt artifacting but fall back to inline when service unavailable
 * 3. Existing text/plain representations are preserved without modification
 */
Deno.test("RuntimeAgent Text Representations for Artifacts", async (t) => {
  await t.step(
    "should preserve existing text/plain for small inline images",
    async () => {
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

      await agent.start();

      // Create representations with existing text/plain
      const representations: Record<string, MediaContainer> = {
        "image/png": {
          type: "inline",
          data:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jINmGwAAAABJRU5ErkJggg==",
          metadata: {},
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

      // Create a cell first
      const cellId = "test-cell-123";
      agent.store.commit(events.cellCreated({
        id: cellId,
        cellType: "code",
        position: 0,
        createdBy: "test-user",
      }));

      // Request execution
      const queueId = crypto.randomUUID();
      agent.store.commit(events.executionRequested({
        queueId,
        cellId,
        executionCount: 1,
        requestedBy: "test-user",
      }));

      await sleep(500); // Increased timeout for execution to complete

      const results = agent.store.query(queryDb(
        {
          query:
            sql`SELECT id, cellId, json_extract(representations, '$."image/png".type') as "image/png:type", json_extract(representations, '$."image/png".artifactId') as "image/png:artifactId", json_extract(representations, '$."image/png".metadata.originalSizeBytes') as "image/png:originalSizeBytes", json_extract(representations, '$."text/plain".type') as "text/plain:type", json_extract(representations, '$."text/plain".data') as "text/plain:data", json_extract(representations, '$."text/markdown".type') as "text/markdown:type", json_extract(representations, '$."text/markdown".data') as "text/markdown:data" FROM outputs WHERE mimeType='image/png';`,
          schema: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              cellId: Schema.String,
              "image/png:type": Schema.Union(Schema.String, Schema.Null),
              "image/png:artifactId": Schema.Union(Schema.String, Schema.Null),
              "image/png:originalSizeBytes": Schema.Union(
                Schema.Number,
                Schema.Null,
              ),
              "text/plain:type": Schema.Union(Schema.String, Schema.Null),
              "text/plain:data": Schema.Union(Schema.String, Schema.Null),
              "text/markdown:type": Schema.Union(Schema.String, Schema.Null),
              "text/markdown:data": Schema.Union(Schema.String, Schema.Null),
            }),
          ),
        },
      ));

      assertEquals(results.length, 1);

      assertEquals(results[0]["image/png:type"], "inline");
      assertEquals(results[0]["image/png:artifactId"], null);
      assertEquals(results[0]["image/png:originalSizeBytes"], null);
      assertEquals(results[0]["text/plain:type"], "inline");
      assertEquals(
        results[0]["text/plain:data"],
        '{"type":"inline","data":"<Axes: >","metadata":{}}',
      );
      assertEquals(results[0]["text/markdown:type"], null);
      assertEquals(results[0]["text/markdown:data"], null);

      // Clean up to prevent resource leaks
      await agent.shutdown();
    },
  );

  await t.step(
    "should fall back to inline when artifact service unavailable",
    async () => {
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
        imageArtifactThresholdBytes: 10, // Very low threshold to trigger artifacting
      });

      const agent = new RuntimeAgent(config, capabilities);

      await agent.start();

      // Create a larger image that will exceed the 10-byte threshold
      // Repeat the black pixel PNG data to make it larger
      const blackPixelBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jINmGwAAAABJRU5ErkJggg==";
      const largeImageBase64 = blackPixelBase64.repeat(10); // Much larger than 10 bytes

      const representations: RawOutputData = {
        "image/png": largeImageBase64,
      };

      agent.onExecution(async (execCtx) => {
        await execCtx.display(representations);
        return { success: true };
      });

      // Create a cell first
      const cellId = "test-cell-456";
      agent.store.commit(events.cellCreated({
        id: cellId,
        cellType: "code",
        position: 0,
        createdBy: "test-user",
      }));

      // Request execution
      const queueId = crypto.randomUUID();
      agent.store.commit(events.executionRequested({
        queueId,
        cellId,
        executionCount: 1,
        requestedBy: "test-user",
      }));

      await sleep(1000); // Wait longer for artifact upload to complete

      const results = agent.store.query(queryDb(
        {
          query:
            sql`SELECT id, cellId, json_extract(representations, '$."image/png".type') as "image/png:type", json_extract(representations, '$."image/png".artifactId') as "image/png:artifactId", json_extract(representations, '$."text/plain".type') as "text/plain:type", json_extract(representations, '$."text/plain".data') as "text/plain:data", json_extract(representations, '$."text/markdown".type') as "text/markdown:type", json_extract(representations, '$."text/markdown".data') as "text/markdown:data" FROM outputs WHERE mimeType='image/png';`,
          schema: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              cellId: Schema.String,
              "image/png:type": Schema.Union(Schema.String, Schema.Null),
              "image/png:artifactId": Schema.Union(Schema.String, Schema.Null),
              "text/plain:type": Schema.Union(Schema.String, Schema.Null),
              "text/plain:data": Schema.Union(Schema.String, Schema.Null),
              "text/markdown:type": Schema.Union(Schema.String, Schema.Null),
              "text/markdown:data": Schema.Union(Schema.String, Schema.Null),
            }),
          ),
        },
      ));

      assertEquals(results.length, 1);

      // Verify image fell back to inline when artifact upload failed
      assertEquals(results[0]["image/png:type"], "inline");
      assertEquals(results[0]["image/png:artifactId"], null);

      // Verify no text representations were generated (only for successful artifacts)
      assertEquals(results[0]["text/plain:type"], null);
      assertEquals(results[0]["text/plain:data"], null);
      assertEquals(results[0]["text/markdown:type"], null);
      assertEquals(results[0]["text/markdown:data"], null);

      // Clean up to prevent resource leaks
      await agent.shutdown();
    },
  );

  await t.step(
    "should generate text representations for successful artifacts",
    async () => {
      // Create mock artifact client for successful uploads
      const mockArtifactClient: IArtifactClient = {
        submitContent: (_data, _options) => {
          return Promise.resolve({ artifactId: "test-artifact-success-123" });
        },
        getArtifactUrl: (artifactId) => {
          return `https://artifacts.test/${artifactId}`;
        },
      };

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
        imageArtifactThresholdBytes: 10, // Very low threshold to trigger artifacting
        artifactClient: mockArtifactClient,
      });

      const agent = new RuntimeAgent(config, capabilities);

      await agent.start();

      const blackPixelBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jINmGwAAAABJRU5ErkJggg==";

      const representations: RawOutputData = {
        "image/png": blackPixelBase64,
      };

      agent.onExecution(async (execCtx) => {
        await execCtx.display(representations);
        return { success: true };
      });

      // Create a cell first
      const cellId = "test-cell-789";
      agent.store.commit(events.cellCreated({
        id: cellId,
        cellType: "code",
        position: 0,
        createdBy: "test-user",
      }));

      // Request execution
      const queueId = crypto.randomUUID();
      agent.store.commit(events.executionRequested({
        queueId,
        cellId,
        executionCount: 1,
        requestedBy: "test-user",
      }));

      await sleep(500); // Wait for execution to complete

      const results = agent.store.query(queryDb(
        {
          query:
            sql`SELECT id, cellId, json_extract(representations, '$."image/png".type') as "image/png:type", json_extract(representations, '$."image/png".artifactId') as "image/png:artifactId", json_extract(representations, '$."text/plain".type') as "text/plain:type", json_extract(representations, '$."text/plain".data') as "text/plain:data", json_extract(representations, '$."text/markdown".type') as "text/markdown:type", json_extract(representations, '$."text/markdown".data') as "text/markdown:data" FROM outputs WHERE mimeType='image/png';`,
          schema: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              cellId: Schema.String,
              "image/png:type": Schema.Union(Schema.String, Schema.Null),
              "image/png:artifactId": Schema.Union(Schema.String, Schema.Null),
              "text/plain:type": Schema.Union(Schema.String, Schema.Null),
              "text/plain:data": Schema.Union(Schema.String, Schema.Null),
              "text/markdown:type": Schema.Union(Schema.String, Schema.Null),
              "text/markdown:data": Schema.Union(Schema.String, Schema.Null),
            }),
          ),
        },
      ));

      assertEquals(results.length, 1);

      // Verify image was stored as artifact
      assertEquals(results[0]["image/png:type"], "artifact");
      assertEquals(
        results[0]["image/png:artifactId"],
        "test-artifact-success-123",
      );

      // Verify text representations were generated
      assertEquals(results[0]["text/plain:type"], "inline");
      assertEquals(results[0]["text/markdown:type"], "inline");

      // Verify text content contains artifact references
      const plainText = results[0]["text/plain:data"];
      const markdownText = results[0]["text/markdown:data"];

      assertEquals(typeof plainText, "string");
      assertEquals(typeof markdownText, "string");

      // Check that URLs are properly constructed
      assertEquals(
        plainText,
        "image/png artifact: https://artifacts.test/test-artifact-success-123",
      );
      assertEquals(
        markdownText,
        "![Artifact_test_artifact_success_123image_png](https://artifacts.test/test-artifact-success-123)",
      );

      // Clean up to prevent resource leaks
      await agent.shutdown();
    },
  );
});
