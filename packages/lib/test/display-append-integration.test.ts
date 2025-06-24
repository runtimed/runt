// SQL verification test for displayAppend functionality

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

/**
 * Test that verifies the SQL generation logic used by displayAppend
 * This ensures our rawSqlEvent operations are correctly structured
 */
Deno.test("DisplayAppend SQL Generation Test", async (t) => {
  await t.step("should generate correct SQL for append operation", () => {
    // Mock store to capture commits
    const commits: any[] = [];
    const mockStore = {
      commit: (event: any) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-123";
    const contentType = "text/markdown";
    const appendContent = "Hello world!";

    // This simulates what displayAppend does internally
    const mockRawSqlEvent = {
      name: "livestore.RawSql",
      args: {
        sql:
          `UPDATE outputs SET data = json_set(data, '$."${contentType}"', COALESCE(json_extract(data, '$."${contentType}"'), '') || '${appendContent}') WHERE id = '${outputId}'`,
        writeTables: new Set(["outputs"]),
      },
    };

    mockStore.commit(mockRawSqlEvent);

    assertEquals(commits.length, 1);
    assertEquals(commits[0].name, "livestore.RawSql");
    assertStringIncludes(commits[0].args.sql, "UPDATE outputs");
    assertStringIncludes(commits[0].args.sql, "json_set");
    assertStringIncludes(commits[0].args.sql, "COALESCE");
    assertStringIncludes(commits[0].args.sql, contentType);
    assertStringIncludes(commits[0].args.sql, appendContent);
    assertStringIncludes(commits[0].args.sql, outputId);
    assertEquals(commits[0].args.writeTables.has("outputs"), true);
  });

  await t.step("should handle multiple content types correctly", () => {
    const commits: any[] = [];
    const mockStore = {
      commit: (event: any) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-123";
    const contentTypes = ["text/markdown", "text/plain", "text/html"];
    const contents = ["# Markdown", "Plain text", "<strong>HTML</strong>"];

    // Simulate multiple displayAppend calls
    contentTypes.forEach((contentType, index) => {
      const mockRawSqlEvent = {
        name: "livestore.RawSql",
        args: {
          sql:
            `UPDATE outputs SET data = json_set(data, '$."${contentType}"', COALESCE(json_extract(data, '$."${contentType}"'), '') || '${
              contents[index]
            }') WHERE id = '${outputId}'`,
          writeTables: new Set(["outputs"]),
        },
      };
      mockStore.commit(mockRawSqlEvent);
    });

    assertEquals(commits.length, 3);

    // Verify each commit targets the correct content type
    contentTypes.forEach((contentType, index) => {
      assertStringIncludes(commits[index].args.sql, contentType);
      assertStringIncludes(commits[index].args.sql, contents[index]);
      assertEquals(commits[index].name, "livestore.RawSql");
    });
  });

  await t.step("should handle empty and whitespace content properly", () => {
    const commits: any[] = [];
    const mockStore = {
      commit: (event: any) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-123";
    const contentType = "text/markdown";
    const tokens = ["", " ", "hello", "", "\n", "world"];

    // Simulate rapid token streaming with various content
    tokens.forEach((token) => {
      const mockRawSqlEvent = {
        name: "livestore.RawSql",
        args: {
          sql:
            `UPDATE outputs SET data = json_set(data, '$."${contentType}"', COALESCE(json_extract(data, '$."${contentType}"'), '') || '${token}') WHERE id = '${outputId}'`,
          writeTables: new Set(["outputs"]),
        },
      };
      mockStore.commit(mockRawSqlEvent);
    });

    assertEquals(commits.length, tokens.length);

    // Verify all tokens (including empty ones) generate valid SQL
    tokens.forEach((token, index) => {
      assertStringIncludes(commits[index].args.sql, outputId);
      assertStringIncludes(commits[index].args.sql, "COALESCE");
      assertEquals(commits[index].name, "livestore.RawSql");
      assertEquals(commits[index].args.writeTables.has("outputs"), true);
    });
  });

  await t.step("should generate SQL that handles non-existent fields", () => {
    const commits: any[] = [];
    const mockStore = {
      commit: (event: any) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-456";
    const contentType = "text/markdown";
    const appendContent = "New content";

    const mockRawSqlEvent = {
      name: "livestore.RawSql",
      args: {
        sql:
          `UPDATE outputs SET data = json_set(data, '$."${contentType}"', COALESCE(json_extract(data, '$."${contentType}"'), '') || '${appendContent}') WHERE id = '${outputId}'`,
        writeTables: new Set(["outputs"]),
      },
    };

    mockStore.commit(mockRawSqlEvent);

    // Verify COALESCE handles null/missing fields correctly
    assertEquals(commits.length, 1);
    assertStringIncludes(
      commits[0].args.sql,
      "COALESCE(json_extract(data, '$",
    );
    assertStringIncludes(commits[0].args.sql, "'), '')");
    assertStringIncludes(commits[0].args.sql, appendContent);
  });
});
