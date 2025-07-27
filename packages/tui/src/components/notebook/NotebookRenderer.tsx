import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useQuery, useStore } from "@livestore/react";
import { queryDb } from "@livestore/livestore";
import { type CellType, events, type OutputData, tables } from "@runt/schema";
import { Colors } from "../../utils/colors.ts";
import { Header } from "../layout/Header.tsx";
import { Footer } from "../layout/Footer.tsx";
import { ScrollableWithSelection } from "../layout/ScrollableWithSelection.tsx";
import { Cell } from "./Cell.tsx";
import { toggleLogs, useSimpleLogging } from "../../utils/simpleLogging.ts";
import { CellEditor } from "./CellEditor.tsx";

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

  const titleMetadata = useQuery(
    queryDb(tables.notebookMetadata.select().where({ key: "title" })),
  );

  const cells = useQuery(
    queryDb(
      tables.cells.select().orderBy([{ col: "position", direction: "asc" }]),
    ),
  );

  const outputs = useQuery(queryDb(tables.outputs.select()));

  const runtimeSessions = useQuery(queryDb(tables.runtimeSessions.select()));

  const outputDeltas = useQuery(queryDb(tables.outputDeltas.select()));

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
    const newPosition = cells.length > 0
      ? Math.max(...cells.map((c) => c.position)) + 1
      : 0;

    store.commit(
      events.cellCreated({
        id: newCellId,
        cellType: "code",
        position: newPosition,
        createdBy: "tui-client",
        actorId: "tui-client",
      }),
    );

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

    let newPosition: number;
    let newSelectionIndex = selectedCellIndex;

    if (position === "above") {
      newPosition = selectedCellIndex > 0
        ? (cells[selectedCellIndex - 1].position + selectedCell.position) / 2
        : selectedCell.position - 1;
      // Don't change selection - new cell is above
    } else {
      // position === "below"
      newPosition = selectedCellIndex < cells.length - 1
        ? (selectedCell.position + cells[selectedCellIndex + 1].position) / 2
        : selectedCell.position + 1;
      newSelectionIndex = selectedCellIndex + 1;
    }

    store.commit(
      events.cellCreated({
        id: newCellId,
        cellType,
        position: newPosition,
        createdBy: "tui-client",
        actorId: "tui-client",
      }),
    );

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

    // 3. Create new cell after current one
    const currentCellIndex = cells.findIndex((c) => c.id === cellId);
    const newCellId = `cell-${Date.now()}`;
    const newPosition =
      currentCellIndex >= 0 && currentCellIndex < cells.length - 1
        ? (cells[currentCellIndex].position +
          cells[currentCellIndex + 1].position) / 2
        : (currentCell?.position || 0) + 1;

    store.commit(
      events.cellCreated({
        id: newCellId,
        cellType: "code",
        position: newPosition,
        createdBy: "tui-client",
        actorId: "tui-client",
      }),
    );

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
    const newPosition =
      selectedCellIndex >= 0 && selectedCellIndex < cells.length - 1
        ? (cells[selectedCellIndex].position +
          cells[selectedCellIndex + 1].position) / 2
        : (selectedCell.position || 0) + 1;

    store.commit(
      events.cellCreated({
        id: newCellId,
        cellType: "code",
        position: newPosition,
        createdBy: "tui-client",
        actorId: "tui-client",
      }),
    );

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

    // Global shortcuts (work in both modes)
    if (input.toLowerCase() === "l" && !key.ctrl && !key.meta) {
      toggleLogs();
      return;
    }

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

  // Reconstruct streaming outputs by combining base outputs with deltas
  const outputsWithDeltas = outputs.map((output) => {
    if (output.outputType === "markdown") {
      // Get deltas for this output, sorted by sequence number
      const deltas = outputDeltas
        .filter((delta) => delta.outputId === output.id)
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

      if (deltas.length > 0) {
        // Reconstruct full content by concatenating base + deltas
        const fullContent =
          (typeof output.data === "string" ? output.data : "") +
          deltas.map((delta) => delta.delta).join("");

        return {
          ...output,
          data: fullContent,
        };
      }
    }
    return output;
  });

  const outputsByCell = outputsWithDeltas.reduce((acc, output) => {
    if (!acc[output.cellId]) {
      acc[output.cellId] = [];
    }
    acc[output.cellId] = [...(acc[output.cellId] || []), output];
    return acc;
  }, {} as Record<string, OutputData[]>);

  const { terminalWidth, terminalHeight } = React.useMemo(() => {
    const terminalSize = Deno.consoleSize();
    return {
      terminalWidth: terminalSize?.columns || 80,
      terminalHeight: terminalSize?.rows || 24,
    };
  }, []); // Only calculate once on mount

  const headerHeight = compact ? 3 : 3;
  const footerHeight = compact ? 2 : 10; // Fixed height for footer with logs
  const safetyMargin = 1;
  const availableHeight = Math.max(
    5,
    terminalHeight - headerHeight - footerHeight - safetyMargin,
  );

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
                outputs={outputsByCell[cell.id] || []}
                showMetadata={showMetadata}
                compact={compact}
                isSelected={index === selectedCellIndex}
                mode={mode}
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
