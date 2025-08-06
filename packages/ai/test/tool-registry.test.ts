import { assertEquals } from "jsr:@std/assert@1.0.13";
import { NOTEBOOK_TOOLS_EXPORT } from "../tool-registry.ts";

Deno.test({
  name: "Tool Registry - create_cell API changes",
}, async (t) => {
  await t.step("create_cell tool should use after_id parameter", () => {
    const createCellTool = NOTEBOOK_TOOLS_EXPORT.find((tool) =>
      tool.name === "create_cell"
    );

    // Tool should exist
    assertEquals(createCellTool?.name, "create_cell");

    // Should require after_id parameter
    assertEquals(
      createCellTool?.parameters?.required?.includes("after_id"),
      true,
      "after_id should be a required parameter",
    );

    // after_id should be string type
    assertEquals(
      createCellTool?.parameters?.properties?.after_id?.type,
      "string",
      "after_id should be a string parameter",
    );

    // Should not have position parameter anymore
    assertEquals(
      "position" in (createCellTool?.parameters?.properties || {}),
      false,
      "position parameter should be removed",
    );

    // cellType should now be optional (with default), source should still be required
    assertEquals(
      createCellTool?.parameters?.required?.includes("cellType"),
      false,
      "cellType should now be optional",
    );
    assertEquals(
      createCellTool?.parameters?.required?.includes("source"),
      true,
      "source should remain required",
    );
  });

  await t.step("create_cell tool should have updated description", () => {
    const createCellTool = NOTEBOOK_TOOLS_EXPORT.find((tool) =>
      tool.name === "create_cell"
    );

    // Description should mention "after a specific cell"
    assertEquals(
      createCellTool?.description?.includes("after a specific cell"),
      true,
      "Description should mention placement after specific cell",
    );

    // Description should mention cell ID
    assertEquals(
      createCellTool?.description?.includes("cell ID"),
      true,
      "Description should mention cell ID usage",
    );

    // Should not mention old position terms
    assertEquals(
      createCellTool?.description?.includes("after_current"),
      false,
      "Description should not mention old position terms",
    );
  });

  await t.step("after_id parameter should have correct description", () => {
    const createCellTool = NOTEBOOK_TOOLS_EXPORT.find((tool) =>
      tool.name === "create_cell"
    );

    const afterIdParam = createCellTool?.parameters?.properties?.after_id;

    assertEquals(
      afterIdParam?.description?.includes(
        "ID of the cell to place this new cell after",
      ),
      true,
      "after_id description should explain placement",
    );

    assertEquals(
      afterIdParam?.description?.includes("your own cell ID"),
      true,
      "after_id description should mention using own cell ID",
    );
  });
});
