import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useQuery, useStore } from "@livestore/react";
import {
  type CellData,
  type CellReference,
  type CellType,
  createCellBetween,
  events,
  type OutputData,
} from "@runt/schema";
import { Colors } from "../../utils/colors.ts";
import { Header } from "../layout/Header.tsx";
import { Footer } from "../layout/Footer.tsx";
import { ScrollableWithSelection } from "../layout/ScrollableWithSelection.tsx";
import { Cell } from "./Cell.tsx";
import { CellEditor } from "./CellEditor.tsx";
import { estimateTextHeight } from "../../utils/textUtils.ts";
import { shouldRenderAsJson } from "../../utils/representationSelector.ts";
import {
  cellQuery,
  cellReferences$,
  notebookMetadata$,
  runtimeSessions$,
} from "@runt/schema";

// Helper to estimate the height of a cell from minimal reference data
const estimateCellHeightFromReference = (
  cellRef: { id: string; fractionalIndex: string | null; cellType: string },
  compact: boolean,
  terminalWidth: number,
): number => {
  let height = 0;

  // Base height: badge line + margin (conservative)
  height += 2;

  // Estimate source height based on cell type (conservative)
  // We don't have actual source, so use typical heights per type
  switch (cellRef.cellType) {
    case "markdown":
      height += 4; // Typical markdown cell
      break;
    case "code":
      height += 6; // Typical code cell
      break;
    case "sql":
      height += 3; // Typical SQL query
      break;
    case "ai":
      height += 8; // AI cells tend to be longer
      break;
    default:
      height += 3; // Default estimate
  }

  // Conservative estimate for potential outputs
  height += 5;

  return height;
};

interface NotebookRendererProps {
  notebookId: string;
  compact?: boolean;
  showMetadata?: boolean;
  syncUrl?: string;
}

export const NotebookRenderer: React.FC<NotebookRendererProps> = ({
  notebookId,
  compact = false,
  showMetadata = true,
  syncUrl,
}) => {
  const [selectedCellIndex, setSelectedCellIndex] = useState(0);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [mode, setMode] = useState<"command" | "edit">("command");
  const [lastDKeyTime, setLastDKeyTime] = useState<number>(0);
  const { store } = useStore();

  const notebookMetadata = useQuery(notebookMetadata$);
  const titleMetadata = notebookMetadata.filter((m) => m.key === "title");

  const cellReferences = useQuery(cellReferences$);

  const runtimeSessions = useQuery(runtimeSessions$);

  const title = titleMetadata.length > 0
    ? titleMetadata[0]?.value || "Untitled Notebook"
    : "Untitled Notebook";

  // Cell type cycling order: code → markdown → ai → sql → code
  const cellTypeOrder: CellType[] = ["code", "markdown", "ai", "sql"];

  // Get available AI models from active runtime sessions
  const availableAiModels = runtimeSessions
    .filter((r) => r.status === "ready" && r.availableAiModels)
    .flatMap((r) => r.availableAiModels || []);

  // Helper functions for cell operations
  const createNewCell = () => {
    if (!store) return;

    const newCellId = `cell-${Date.now()}`;

    // Place at end: after the last cell
    const cellBefore = cellReferences.length > 0
      ? cellReferences[cellReferences.length - 1]
      : null;
    const cellAfter = null;

    const createEvents = createCellBetween(
      {
        id: newCellId,
        cellType: "code",
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
      [...cellReferences],
    );
    createEvents.forEach((event) => store.commit(event));

    // Select the new cell
    setSelectedCellIndex(cellReferences.length);
  };

  const createCellWithType = (
    cellType: CellType,
    position: "above" | "below",
  ) => {
    if (!store || cellReferences.length === 0) return;

    const selectedCellRef = cellReferences[selectedCellIndex];
    const newCellId = `cell-${Date.now()}`;

    let cellBefore = null;
    let cellAfter = null;
    let newSelectionIndex = selectedCellIndex;

    if (position === "above") {
      cellBefore = selectedCellIndex > 0
        ? cellReferences[selectedCellIndex - 1]
        : null;
      cellAfter = selectedCellRef;
      newSelectionIndex = selectedCellIndex;
    } else {
      // position === "below"
      cellBefore = selectedCellRef;
      cellAfter = selectedCellIndex < cellReferences.length - 1
        ? cellReferences[selectedCellIndex + 1]
        : null;
      newSelectionIndex = selectedCellIndex + 1;
    }

    const createEvents = createCellBetween(
      {
        id: newCellId,
        cellType,
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
      [...cellReferences],
    );
    createEvents.forEach((event) => store.commit(event));

    if (position === "below") {
      setSelectedCellIndex(newSelectionIndex);
    }
  };

  const cycleCellType = () => {
    if (!store || cellReferences.length === 0) return;

    const selectedCellRef = cellReferences[selectedCellIndex];
    if (!selectedCellRef) return;

    // Query full cell data for cell type operations
    const selectedCell = store.query(cellQuery.byId(selectedCellRef.id));
    if (!selectedCell) return;

    const currentTypeIndex = cellTypeOrder.indexOf(
      selectedCell.cellType as CellType,
    );
    const nextTypeIndex = (currentTypeIndex + 1) % cellTypeOrder.length;
    const nextCellType = cellTypeOrder[nextTypeIndex];

    store.commit(
      events.cellTypeChanged({
        id: selectedCell.id,
        cellType: nextCellType,
        actorId: "tui-client",
      }),
    );
  };

  const cycleAiModel = () => {
    if (!store || cellReferences.length === 0) return;

    const selectedCellRef = cellReferences[selectedCellIndex];
    if (!selectedCellRef || selectedCellRef.cellType !== "ai") return;

    // Query full cell data for AI model operations
    const selectedCell = store.query(cellQuery.byId(selectedCellRef.id));
    if (!selectedCell) return;

    if (availableAiModels.length === 0) {
      // No models available - maybe show a message?
      return;
    }

    const currentModel = selectedCell.aiModel;
    const currentProvider = selectedCell.aiProvider;

    // Find current model index
    let currentIndex = -1;
    if (currentModel && currentProvider) {
      currentIndex = availableAiModels.findIndex(
        (m) => m.name === currentModel && m.provider === currentProvider,
      );
    }

    // Get next model (or first if current not found)
    const nextIndex = (currentIndex + 1) % availableAiModels.length;
    const nextModel = availableAiModels[nextIndex];

    store.commit(
      events.aiSettingsChanged({
        cellId: selectedCell.id,
        provider: nextModel.provider,
        model: nextModel.name,
        settings: selectedCell.aiSettings || {},
      }),
    );
  };

  const deleteSelectedCell = () => {
    if (!store || cellReferences.length === 0) return;

    const selectedCellRef = cellReferences[selectedCellIndex];
    if (!selectedCellRef) return;

    store.commit(
      events.cellDeleted({
        id: selectedCellRef.id,
        actorId: "tui-client",
      }),
    );

    // Adjust selected index if needed
    if (selectedCellIndex >= cellReferences.length - 1) {
      setSelectedCellIndex(Math.max(0, cellReferences.length - 2));
    }
  };

  const startEditingCell = () => {
    if (cellReferences.length === 0) return;
    const selectedCellRef = cellReferences[selectedCellIndex];
    if (selectedCellRef) {
      setEditingCellId(selectedCellRef.id);
      setMode("edit");
    }
  };

  const saveCell = (cellId: string, newSource: string) => {
    if (!store) return;

    store.commit(
      events.cellSourceChanged({
        id: cellId,
        source: newSource,
        modifiedBy: "tui-client",
      }),
    );

    setEditingCellId(null);
    setMode("command");
  };

  const cancelEditing = () => {
    setEditingCellId(null);
    setMode("command");
  };

  const executeAndCreateNew = (cellId: string, newSource: string) => {
    if (!store) return;

    // 1. Save the cell source
    store.commit(
      events.cellSourceChanged({
        id: cellId,
        source: newSource,
        modifiedBy: "tui-client",
      }),
    );

    // 2. Request execution
    const queueId = `queue-${Date.now()}`;
    const currentCellRef = cellReferences.find((c) => c.id === cellId);
    const currentCell = store?.query(cellQuery.byId(cellId));
    const executionCount = (currentCell?.executionCount || 0) + 1;

    store.commit(
      events.executionRequested({
        queueId,
        cellId,
        executionCount,
        requestedBy: "tui-client",
        actorId: "tui-client",
      }),
    );

    // Create new cell after current one
    const currentCellIndex = cellReferences.findIndex((c) => c.id === cellId);
    const newCellId = `cell-${Date.now()}`;

    const cellBefore = currentCellRef || null;
    const cellAfter =
      currentCellIndex >= 0 && currentCellIndex < cellReferences.length - 1
        ? cellReferences[currentCellIndex + 1]
        : null;

    const createEvents = createCellBetween(
      {
        id: newCellId,
        cellType: "code",
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
      [...cellReferences],
    );
    createEvents.forEach((event) => store.commit(event));

    // 4. Exit editing mode and select the new cell
    setEditingCellId(null);
    setMode("command");
    setSelectedCellIndex(currentCellIndex + 1);
  };

  const executeOnly = (cellId: string, newSource: string) => {
    if (!store) return;

    // 1. Save the cell source
    store.commit(
      events.cellSourceChanged({
        id: cellId,
        source: newSource,
        modifiedBy: "tui-client",
      }),
    );

    // 2. Request execution
    const queueId = `queue-${Date.now()}`;
    const currentCellRef = cellReferences.find((c) => c.id === cellId);
    const currentCell = store?.query(cellQuery.byId(cellId));
    const executionCount = (currentCell?.executionCount || 0) + 1;

    store.commit(
      events.executionRequested({
        queueId,
        cellId,
        executionCount,
        requestedBy: "tui-client",
        actorId: "tui-client",
      }),
    );

    // 3. Exit editing mode (no new cell creation)
    setEditingCellId(null);
    setMode("command");
  };

  // Command mode execution functions (execute current cell without editing first)
  const executeCurrentCellAndCreateNew = () => {
    if (cellReferences.length === 0) return;
    const selectedCellRef = cellReferences[selectedCellIndex];
    if (!selectedCellRef || !store) return;

    // Query full cell data for execution
    const selectedCell = store.query(cellQuery.byId(selectedCellRef.id));
    if (!selectedCell) return;

    // 1. Request execution with current source
    const queueId = `queue-${Date.now()}`;
    const executionCount = (selectedCell.executionCount || 0) + 1;

    store.commit(
      events.executionRequested({
        queueId,
        cellId: selectedCell.id,
        executionCount,
        requestedBy: "tui-client",
        actorId: "tui-client",
      }),
    );

    // 2. Create new cell after current one
    const newCellId = `cell-${Date.now()}`;

    const cellBefore = selectedCell;
    const cellAfter =
      selectedCellIndex >= 0 && selectedCellIndex < cellReferences.length - 1
        ? cellReferences[selectedCellIndex + 1]
        : null;

    const createEvents = createCellBetween(
      {
        id: newCellId,
        cellType: "code",
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
      [...cellReferences],
    );
    createEvents.forEach((event) => store.commit(event));

    // 3. Select the new cell
    setSelectedCellIndex(selectedCellIndex + 1);
  };

  const executeCurrentCellOnly = () => {
    if (cellReferences.length === 0) return;
    const selectedCellRef = cellReferences[selectedCellIndex];
    if (!selectedCellRef || !store) return;

    // Query full cell data for execution
    const selectedCell = store.query(cellQuery.byId(selectedCellRef.id));
    if (!selectedCell) return;

    // Request execution with current source
    const queueId = `queue-${Date.now()}`;
    const executionCount = (selectedCell.executionCount || 0) + 1;

    store.commit(
      events.executionRequested({
        queueId,
        cellId: selectedCell.id,
        executionCount,
        requestedBy: "tui-client",
        actorId: "tui-client",
      }),
    );
  };

  useInput((input, key) => {
    // Skip input handling if we're in edit mode (CellEditor handles it)
    if (mode === "edit") return;

    // COMMAND MODE - Modal interface like Jupyter

    // Navigation
    if (key.upArrow || input.toLowerCase() === "k") {
      setSelectedCellIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || input.toLowerCase() === "j") {
      setSelectedCellIndex((prev) =>
        Math.min(cellReferences.length - 1, prev + 1)
      );
      return;
    }

    // Enter edit mode
    if (key.return || input.toLowerCase() === "i") {
      startEditingCell();
      return;
    }

    // Cell execution (single key presses!)
    if (input.toLowerCase() === "r") {
      executeCurrentCellAndCreateNew();
      return;
    }

    if (input.toUpperCase() === "R") {
      executeCurrentCellOnly();
      return;
    }

    // Cell type cycling: Shift-C
    if (input === "C" && key.shift) {
      cycleCellType();
      return;
    }

    // AI model cycling: Shift-T (for model Type)
    if (input === "T" && key.shift) {
      cycleAiModel();
      return;
    }

    // Cell creation with type intent (Shift key combinations)
    if (key.shift) {
      switch (input.toUpperCase()) {
        case "A":
          // Shift-A: Create AI cell above
          createCellWithType("ai", "above");
          return;
        case "M":
          // Shift-M: Create markdown cell above
          createCellWithType("markdown", "above");
          return;
        case "B":
          // Shift-B: Create code cell below (explicit)
          createCellWithType("code", "below");
          return;
        case "S":
          // Shift-S: Create SQL cell below
          createCellWithType("sql", "below");
          return;
        case "N":
          // Shift-N: Create code cell below (shortcut)
          createCellWithType("code", "below");
          return;
      }
    }

    // Cell management (existing behavior preserved)
    if (input.toLowerCase() === "a") {
      // Insert cell above (code type - existing behavior)
      if (!store || cellReferences.length === 0) return;
      const selectedCellRef = cellReferences[selectedCellIndex];
      const newCellId = `cell-${Date.now()}`;
      // Use fractionalIndexBetween for proper string-based fractional indexing
      const cellBefore = selectedCellIndex > 0
        ? cellReferences[selectedCellIndex - 1]
        : null;
      const cellAfter = selectedCellRef;

      const createEvents = createCellBetween(
        {
          id: newCellId,
          cellType: "code",
          createdBy: "tui-client",
        },
        cellBefore,
        cellAfter,
        [...cellReferences],
      );
      createEvents.forEach((event) => store.commit(event));
      // Don't change selection - new cell is above
      return;
    }

    if (input.toLowerCase() === "b") {
      createNewCell();
      return;
    }

    // Delete cell (dd - press d twice)
    if (input.toLowerCase() === "d") {
      const now = Date.now();
      if (now - lastDKeyTime < 1000) { // Within 1 second
        deleteSelectedCell();
        setLastDKeyTime(0); // Reset
      } else {
        setLastDKeyTime(now);
      }
      return;
    }
  });

  React.useEffect(() => {
    if (
      selectedCellIndex >= cellReferences.length && cellReferences.length > 0
    ) {
      setSelectedCellIndex(cellReferences.length - 1);
    }
  }, [cellReferences.length, selectedCellIndex]);

  const { terminalWidth, terminalHeight } = React.useMemo(() => {
    const terminalSize = Deno.consoleSize();
    return {
      terminalWidth: terminalSize?.columns || 80,
      terminalHeight: terminalSize?.rows || 24,
    };
  }, []); // Only calculate once on mount

  const headerHeight = compact ? 2 : 3;
  const footerHeight = compact ? 1 : 1; // Single line footer
  const safetyMargin = 1;
  const availableHeight = Math.max(
    5,
    terminalHeight - headerHeight - footerHeight - safetyMargin,
  );

  // Individual cells will handle their own outputs via cellQuery.outputs(cellId)

  const cellHeights = React.useMemo(() => {
    return cellReferences.map((cellRef) =>
      estimateCellHeightFromReference(
        cellRef,
        compact,
        terminalWidth,
      )
    );
  }, [cellReferences, compact, terminalWidth]);

  if (cellReferences.length === 0) {
    return (
      <Box flexDirection="column">
        {!compact && (
          <Header
            title={title}
            notebookId={notebookId}
            cellCount={0}
            terminalWidth={terminalWidth}
            syncUrl={syncUrl}
          />
        )}

        <Box
          flexGrow={1}
          alignItems="center"
          justifyContent="center"
          flexDirection="column"
        >
          <Text color={Colors.UI.metadata}>📝 No cells in this notebook</Text>
          <Text color={Colors.UI.metadata}>
            Press 'b' to create a new cell
          </Text>
        </Box>

        {!compact && (
          <Footer
            syncStatus="connected"
            terminalWidth={terminalWidth}
          />
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {!compact && (
        <Header
          title={title}
          notebookId={notebookId}
          cellCount={cellReferences.length}
          terminalWidth={terminalWidth}
          syncUrl={syncUrl}
        />
      )}

      <ScrollableWithSelection
        maxHeight={availableHeight}
        selectedIndex={selectedCellIndex}
        showOverflowIndicator={!compact}
        itemHeights={cellHeights}
      >
        {cellReferences.map((cellRef, index) => {
          // Query full cell data only for rendering
          const cell = store?.query(cellQuery.byId(cellRef.id));
          if (!cell) return null;

          return editingCellId === cell.id
            ? (
              <CellEditor
                key={cell.id}
                cell={cell}
                onSave={(newSource) => saveCell(cell.id, newSource)}
                onCancel={cancelEditing}
                onExecuteAndCreateNew={(newSource) =>
                  executeAndCreateNew(cell.id, newSource)}
                onExecuteOnly={(newSource) => executeOnly(cell.id, newSource)}
              />
            )
            : (
              <Cell
                key={cell.id}
                cell={cell}
                showMetadata={showMetadata}
                compact={compact}
                isSelected={index === selectedCellIndex}
                mode={mode}
                cellIndex={index}
              />
            );
        })}
      </ScrollableWithSelection>

      {!compact && (
        <Footer
          syncStatus="connected"
          terminalWidth={terminalWidth}
        />
      )}
    </Box>
  );
};
