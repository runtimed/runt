import React from "react";
import { Box, Text } from "ink";
import { Badge } from "@inkjs/ui";
import { useQuery } from "@livestore/react";
import type { CellData, OutputData } from "@runt/schema";
import { cellQuery, outputDeltas$ } from "../../queries/index.ts";
import { Colors } from "../../utils/colors.ts";
import { CodeHighlighter } from "../../CodeHighlighter.tsx";
import { OutputRenderer } from "../outputs/OutputRenderer.tsx";
import { MarkdownRenderer } from "../outputs/MarkdownRenderer.tsx";

interface CellProps {
  cell: CellData;
  showMetadata?: boolean;
  compact?: boolean;
  isSelected?: boolean;
  mode?: "command" | "edit";
  cellIndex?: number;
}

export const Cell: React.FC<CellProps> = ({
  cell,
  showMetadata = true,
  compact = false,
  isSelected = false,
  mode = "command",
  cellIndex,
}) => {
  // Query outputs for this cell
  const baseOutputs = useQuery(cellQuery.outputs(cell.id));
  const outputDeltas = useQuery(outputDeltas$);

  // Reconstruct streaming outputs by combining base outputs with deltas
  const outputs = React.useMemo(() => {
    return baseOutputs.map((output) => {
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
  }, [baseOutputs, outputDeltas]);

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

  const getCellTypeLabel = (cell: CellData) => {
    if (cell.cellType === "ai") {
      const modelInfo = cell.aiModel
        ? cell.aiModel.replace(/^.*\//, "") // Remove provider prefix if present
        : "no model";
      return `${cell.cellType} (${modelInfo})`;
    }
    return cell.cellType;
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
      <Box marginTop={1} flexDirection="column">
        <Box marginBottom={0}>
          <Text color={Colors.AccentCyan} bold>
            Out:
          </Text>
        </Box>
        {outputs.map((output) => (
          <Box key={output.id} marginBottom={0}>
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
      <Box flexDirection="row" marginBottom={1}>
        {/* Left gutter for cell numbers */}
        <Box width={2} flexShrink={0}>
          <Text color={Colors.UI.metadata} dimColor>
            {cellIndex !== undefined ? `${cellIndex + 1}.` : ""}
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" alignItems="center" marginBottom={1}>
            {/* @ts-expect-error - TUI Badge component in Ink */}
            <Badge color={getCellTypeColor(cell.cellType)}>
              {getCellTypeIcon(cell.cellType)} {getCellTypeLabel(cell)}
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
      </Box>
    );
  }

  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* Left gutter for cell numbers */}
      <Box width={2} flexShrink={0}>
        <Text color={Colors.UI.metadata} dimColor>
          {cellIndex !== undefined ? `${cellIndex + 1}.` : ""}
        </Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle={isSelected ? "single" : undefined}
        borderColor={isSelected
          ? (mode === "edit" ? Colors.UI.warning : Colors.UI.success)
          : undefined}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        paddingY={isSelected ? 1 : 0}
      >
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box flexDirection="row" alignItems="center">
            {/* @ts-expect-error - TUI Badge component in Ink */}
            <Badge color={getCellTypeColor(cell.cellType)}>
              {getCellTypeIcon(cell.cellType)} {getCellTypeLabel(cell)}
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
    </Box>
  );
};
