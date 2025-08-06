import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useQuery, useStore } from "@livestore/react";
import {
  type CellData,
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
  tuiCells$,
  tuiNotebookMetadata$,
  tuiRuntimeSessions$,
} from "../../queries/index.ts";

// Helper to estimate the height of a cell in lines (simplified and conservative)
const estimateCellHeight = (
  cell: CellData,
  compact: boolean,
  terminalWidth: number,
): number => {
  let height = 0;

  // Base height: badge line + margin (conservative)
  height += 2;

  // Source code height (simple line count)
  if (cell.source) {
    height += 1; // marginTop
    height += cell.source.split("\n").length;
  }

  // Conservative estimate for potential outputs (cells handle their own outputs now)
  // Add some buffer space for outputs that may be rendered
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

  const notebookMetadata = useQuery(tuiNotebookMetadata$);
  const titleMetadata = notebookMetadata.filter((m) => m.key === "title");

  const cells = useQuery(tuiCells$);

  const runtimeSessions = useQuery(tuiRuntimeSessions$);

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
    const cellBefore = cells.length > 0 ? cells[cells.length - 1] : null;
    const cellAfter = null;

    const createEvent = createCellBetween(
      {
        id: newCellId,
        cellType: "code",
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
    );

    store.commit(createEvent);

    // Select the new cell
    setSelectedCellIndex(cells.length);
  };

  const createCellWithType = (
    cellType: CellType,
    position: "above" | "below",
  ) => {
    if (!store || cells.length === 0) return;

    const selectedCell = cells[selectedCellIndex];
    const newCellId = `cell-${Date.now()}`;

    let cellBefore = null;
    let cellAfter = null;
    let newSelectionIndex = selectedCellIndex;

    if (position === "above") {
      cellBefore = selectedCellIndex > 0 ? cells[selectedCellIndex - 1] : null;
      cellAfter = selectedCell;
      newSelectionIndex = selectedCellIndex;
    } else {
      // position === "below"
      cellBefore = selectedCell;
      cellAfter = selectedCellIndex < cells.length - 1
        ? cells[selectedCellIndex + 1]
        : null;
      newSelectionIndex = selectedCellIndex + 1;
    }

    const createEvent = createCellBetween(
      {
        id: newCellId,
        cellType,
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
    );

    store.commit(createEvent);

    if (position === "below") {
      setSelectedCellIndex(newSelectionIndex);
    }
  };

  const cycleCellType = () => {
    if (!store || cells.length === 0) return;

    const selectedCell = cells[selectedCellIndex];
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
    if (!store || cells.length === 0) return;

    const selectedCell = cells[selectedCellIndex];
    if (!selectedCell || selectedCell.cellType !== "ai") return;

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
    if (!store || cells.length === 0) return;

    const selectedCell = cells[selectedCellIndex];
    if (!selectedCell) return;

    store.commit(
      events.cellDeleted({
        id: selectedCell.id,
        actorId: "tui-client",
      }),
    );

    // Adjust selected index if needed
    if (selectedCellIndex >= cells.length - 1) {
      setSelectedCellIndex(Math.max(0, cells.length - 2));
    }
  };

  const startEditingCell = () => {
    if (cells.length === 0) return;
    const selectedCell = cells[selectedCellIndex];
    if (selectedCell) {
      setEditingCellId(selectedCell.id);
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
    const currentCell = cells.find((c) => c.id === cellId);
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
    const currentCellIndex = cells.findIndex((c) => c.id === cellId);
    const newCellId = `cell-${Date.now()}`;

    const cellBefore = currentCell || null;
    const cellAfter =
      currentCellIndex >= 0 && currentCellIndex < cells.length - 1
        ? cells[currentCellIndex + 1]
        : null;

    const createEvent = createCellBetween(
      {
        id: newCellId,
        cellType: "code",
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
    );

    store.commit(createEvent);

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
    const currentCell = cells.find((c) => c.id === cellId);
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
    if (cells.length === 0) return;
    const selectedCell = cells[selectedCellIndex];
    if (!selectedCell || !store) return;

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
      selectedCellIndex >= 0 && selectedCellIndex < cells.length - 1
        ? cells[selectedCellIndex + 1]
        : null;

    const createEvent = createCellBetween(
      {
        id: newCellId,
        cellType: "code",
        createdBy: "tui-client",
      },
      cellBefore,
      cellAfter,
    );

    store.commit(createEvent);

    // 3. Select the new cell
    setSelectedCellIndex(selectedCellIndex + 1);
  };

  const executeCurrentCellOnly = () => {
    if (cells.length === 0) return;
    const selectedCell = cells[selectedCellIndex];
    if (!selectedCell || !store) return;

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
      setSelectedCellIndex((prev) => Math.min(cells.length - 1, prev + 1));
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
      if (!store || cells.length === 0) return;
      const selectedCell = cells[selectedCellIndex];
      const newCellId = `cell-${Date.now()}`;
      const newPosition = selectedCellIndex > 0
        ? (cells[selectedCellIndex - 1].position + selectedCell.position) / 2
        : selectedCell.position - 1;

      store.commit(
        events.cellCreated({
          id: newCellId,
          cellType: "code",
          position: newPosition,
          createdBy: "tui-client",
          actorId: "tui-client",
        }),
      );
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
    if (selectedCellIndex >= cells.length && cells.length > 0) {
      setSelectedCellIndex(cells.length - 1);
    }
  }, [cells.length, selectedCellIndex]);

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
    return cells.map((cell) =>
      estimateCellHeight(
        cell,
        compact,
        terminalWidth,
      )
    );
  }, [cells, compact, terminalWidth]);

  if (cells.length === 0) {
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
          cellCount={cells.length}
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
        {cells.map((cell, index) => (
          editingCellId === cell.id
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
            )
        ))}
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
