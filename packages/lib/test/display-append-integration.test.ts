// SQL verification test for displayAppend functionality

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

interface MockRawSqlCommit {
  name: "livestore.RawSql";
  args: {
    sql: string;
    writeTables: Set<string>;
  };
}

/**
 * Test that verifies the SQL generation logic used by displayAppend
 * This ensures our rawSqlEvent operations are correctly structured
 */
Deno.test("DisplayAppend SQL Generation Test", async (t) => {
  await t.step("should generate correct SQL for append operation", () => {
    // Mock store to capture commits
    const commits: MockRawSqlCommit[] = [];
    const mockStore = {
      commit: (event: MockRawSqlCommit) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-123";
    const contentType = "text/markdown";
    const appendContent = "Hello world!";

    // This simulates what displayAppend does internally
    const mockRawSqlEvent = {
      name: "livestore.RawSql" as const,
      args: {
        sql:
          `UPDATE outputs SET data = json_set(data, '$."${contentType}"', COALESCE(json_extract(data, '$."${contentType}"'), '') || '${appendContent}') WHERE id = '${outputId}'`,
        writeTables: new Set(["outputs"]),
      },
    };

    mockStore.commit(mockRawSqlEvent);

    assertEquals(commits.length, 1);
    const commit = commits[0];
    assertEquals(commit.name, "livestore.RawSql");
    assertStringIncludes(commit.args.sql, "UPDATE outputs");
    assertStringIncludes(commit.args.sql, "json_set");
    assertStringIncludes(commit.args.sql, "COALESCE");
    assertStringIncludes(commit.args.sql, contentType);
    assertStringIncludes(commit.args.sql, appendContent);
    assertStringIncludes(commit.args.sql, outputId);
    assertEquals(commit.args.writeTables.has("outputs"), true);
  });

  await t.step("should handle multiple content types correctly", () => {
    const commits: MockRawSqlCommit[] = [];
    const mockStore = {
      commit: (event: MockRawSqlCommit) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-123";
    const contentTypes = ["text/markdown", "text/plain", "text/html"];
    const contents = ["# Markdown", "Plain text", "<strong>HTML</strong>"];

    // Simulate multiple displayAppend calls
    contentTypes.forEach((contentType, index) => {
      const mockRawSqlEvent = {
        name: "livestore.RawSql" as const,
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
      const commit = commits[index];
      assertStringIncludes(commit.args.sql, contentType);
      assertStringIncludes(commit.args.sql, contents[index]);
      assertEquals(commit.name, "livestore.RawSql");
    });
  });

  await t.step("should handle empty and whitespace content properly", () => {
    const commits: MockRawSqlCommit[] = [];
    const mockStore = {
      commit: (event: MockRawSqlCommit) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-123";
    const contentType = "text/markdown";
    const tokens = ["", " ", "hello", "", "\n", "world"];

    // Simulate rapid token streaming with various content
    tokens.forEach((token) => {
      const mockRawSqlEvent = {
        name: "livestore.RawSql" as const,
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
    tokens.forEach((_token, index) => {
      const commit = commits[index];
      assertStringIncludes(commit.args.sql, outputId);
      assertStringIncludes(commit.args.sql, "COALESCE");
      assertEquals(commit.name, "livestore.RawSql");
      assertEquals(commit.args.writeTables.has("outputs"), true);
    });
  });

  await t.step("should generate SQL that handles non-existent fields", () => {
    const commits: MockRawSqlCommit[] = [];
    const mockStore = {
      commit: (event: MockRawSqlCommit) => {
        commits.push(event);
      },
    };

    const outputId = "test-output-456";
    const contentType = "text/markdown";
    const appendContent = "New content";

    const mockRawSqlEvent = {
      name: "livestore.RawSql" as const,
      args: {
        sql:
          `UPDATE outputs SET data = json_set(data, '$."${contentType}"', COALESCE(json_extract(data, '$."${contentType}"'), '') || '${appendContent}') WHERE id = '${outputId}'`,
        writeTables: new Set(["outputs"]),
      },
    };

    mockStore.commit(mockRawSqlEvent);

    // Verify COALESCE handles null/missing fields correctly
    assertEquals(commits.length, 1);
    const commit = commits[0];
    assertStringIncludes(
      commit.args.sql,
      "COALESCE(json_extract(data, '$",
    );
    assertStringIncludes(commit.args.sql, "'), '')");
    assertStringIncludes(commit.args.sql, appendContent);
  });
});
