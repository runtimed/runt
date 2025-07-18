import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useQuery } from "@livestore/react";
import { queryDb } from "@livestore/livestore";
import { type OutputData, tables } from "@runt/schema";
import { Colors } from "../../utils/colors.ts";
import { Header } from "../layout/Header.tsx";
import { Footer } from "../layout/Footer.tsx";
import { HeightConstrainedBox } from "../layout/HeightConstrainedBox.tsx";
import { Cell } from "./Cell.tsx";
import { toggleLogs, useSimpleLogging } from "../../utils/simpleLogging.ts";

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

  const titleMetadata = useQuery(
    queryDb(tables.notebookMetadata.select().where({ key: "title" })),
  );

  const cells = useQuery(
    queryDb(
      tables.cells.select().orderBy([{ col: "position", direction: "asc" }]),
    ),
  );

  const outputs = useQuery(queryDb(tables.outputs.select()));

  const title = titleMetadata.length > 0
    ? titleMetadata[0]?.value || "Untitled Notebook"
    : "Untitled Notebook";

  useInput((input, key) => {
    if (input.toLowerCase() === "l" && !key.ctrl && !key.meta) {
      toggleLogs();
      return;
    }

    if (cells.length === 0) return;

    if (key.upArrow) {
      setSelectedCellIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedCellIndex((prev) => Math.min(cells.length - 1, prev + 1));
    }
  });

  React.useEffect(() => {
    if (selectedCellIndex >= cells.length && cells.length > 0) {
      setSelectedCellIndex(cells.length - 1);
    }
  }, [cells.length, selectedCellIndex]);

  const outputsByCell = outputs.reduce((acc, output) => {
    if (!acc[output.cellId]) {
      acc[output.cellId] = [];
    }
    acc[output.cellId] = [...(acc[output.cellId] || []), output];
    return acc;
  }, {} as Record<string, OutputData[]>);

  const terminalSize = Deno.consoleSize();
  const terminalWidth = terminalSize?.columns || 80;
  const terminalHeight = terminalSize?.rows || 24;

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
            Create cells in the web interface to see them here
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

      <HeightConstrainedBox
        maxHeight={availableHeight}
        showOverflowIndicator={!compact}
        overflowDirection="bottom"
      >
        {cells.map((cell, index) => (
          <Cell
            key={cell.id}
            cell={cell}
            outputs={outputsByCell[cell.id] || []}
            showMetadata={showMetadata}
            compact={compact}
            isSelected={index === selectedCellIndex}
          />
        ))}
      </HeightConstrainedBox>

      {!compact && (
        <Footer
          syncStatus="connected"
          terminalWidth={terminalWidth}
        />
      )}
    </Box>
  );
};
