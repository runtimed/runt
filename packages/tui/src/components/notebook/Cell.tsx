import React from "react";
import { Box, Text } from "ink";
import { Badge } from "@inkjs/ui";
import type { CellData, OutputData } from "@runt/schema";
import { Colors } from "../../utils/colors.ts";
import { CodeHighlighter } from "../../CodeHighlighter.tsx";
import { OutputRenderer } from "../outputs/OutputRenderer.tsx";
import { MarkdownRenderer } from "../outputs/MarkdownRenderer.tsx";

interface CellProps {
  cell: CellData;
  outputs: OutputData[];
  showMetadata?: boolean;
  compact?: boolean;
  isSelected?: boolean;
}

export const Cell: React.FC<CellProps> = ({
  cell,
  outputs,
  showMetadata = true,
  compact = false,
  isSelected = false,
}) => {
  const getCellTypeColor = (cellType: string) => {
    return (
      Colors.CellType[cellType as keyof typeof Colors.CellType] ||
      Colors.UI.metadata
    );
  };

  const getCellTypeIcon = (cellType: string) => {
    switch (cellType) {
      case "code":
        return "⚡";
      case "ai":
        return "🤖";
      case "markdown":
        return "📝";
      case "sql":
        return "🗃️";
      case "raw":
        return "📄";
      default:
        return "📋";
    }
  };

  const getExecutionStateColor = (state?: string) => {
    switch (state) {
      case "completed":
        return Colors.UI.success;
      case "running":
        return Colors.UI.warning;
      case "error":
        return Colors.UI.error;
      default:
        return Colors.UI.metadata;
    }
  };

  const getExecutionStateIcon = (state?: string) => {
    switch (state) {
      case "completed":
        return "✅";
      case "running":
        return "🔄";
      case "error":
        return "❌";
      default:
        return "";
    }
  };

  const renderCellSource = () => {
    if (!cell.source) return null;

    if (cell.cellType === "code") {
      return (
        <Box marginTop={1}>
          <CodeHighlighter
            code={cell.source}
            language="python"
            showLineNumbers={!compact}
          />
        </Box>
      );
    }

    if (cell.cellType === "markdown") {
      return (
        <Box marginTop={1}>
          <MarkdownRenderer content={cell.source} compact={compact} />
        </Box>
      );
    }

    if (cell.cellType === "sql") {
      return (
        <Box marginTop={1}>
          <CodeHighlighter
            code={cell.source}
            language="sql"
            showLineNumbers={!compact}
          />
        </Box>
      );
    }

    return (
      <Box marginTop={1}>
        <Text wrap="wrap" color={Colors.UI.metadata}>
          {cell.source}
        </Text>
      </Box>
    );
  };

  const renderOutputs = () => {
    if (outputs.length === 0) return null;

    return (
      <Box marginTop={2} flexDirection="column">
        <Box marginBottom={1}>
          <Text color={Colors.AccentCyan} bold>
            Out:
          </Text>
        </Box>
        {outputs.map((output) => (
          <Box key={output.id} marginBottom={1}>
            <OutputRenderer
              output={output}
              showMetadata={showMetadata}
              compact={compact}
            />
          </Box>
        ))}
      </Box>
    );
  };

  if (compact) {
    return (
      <Box flexDirection="column" marginBottom={2}>
        <Box flexDirection="row" alignItems="center" marginBottom={1}>
          {/* @ts-expect-error - TUI Badge component in Ink */}
          <Badge color={getCellTypeColor(cell.cellType)}>
            {getCellTypeIcon(cell.cellType)} {cell.cellType}
          </Badge>
          {cell.executionState && (
            <Box marginLeft={2}>
              <Text color={getExecutionStateColor(cell.executionState)}>
                {getExecutionStateIcon(cell.executionState)}
              </Text>
            </Box>
          )}
        </Box>
        {renderCellSource()}
        {renderOutputs()}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginBottom={2}
      borderStyle="round"
      borderColor={isSelected ? Colors.UI.success : Colors.UI.border}
      borderLeft={false}
      borderRight={false}
      paddingX={0}
      paddingY={1}
      width="100%"
    >
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box flexDirection="row" alignItems="center">
          {/* @ts-expect-error - TUI Badge component in Ink */}
          <Badge color={getCellTypeColor(cell.cellType)}>
            {getCellTypeIcon(cell.cellType)} {cell.cellType}
          </Badge>
          {cell.executionState && (
            <Box marginLeft={2}>
              <Text color={getExecutionStateColor(cell.executionState)}>
                {getExecutionStateIcon(cell.executionState)}{" "}
                {cell.executionState}
              </Text>
            </Box>
          )}
        </Box>

        {showMetadata && cell.lastExecuted && (
          <Box>
            <Text color={Colors.UI.metadata}>
              Last run: {new Date(cell.lastExecuted).toLocaleTimeString()}
            </Text>
          </Box>
        )}
      </Box>

      {renderCellSource()}
      {renderOutputs()}
    </Box>
  );
};
