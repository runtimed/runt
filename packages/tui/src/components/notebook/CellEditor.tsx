import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Badge } from "@inkjs/ui";
import type { CellData } from "@runt/schema";
import { Colors } from "../../utils/colors.ts";

interface CellEditorProps {
  cell: CellData;
  onSave: (newSource: string) => void;
  onCancel: () => void;
  onExecuteAndCreateNew: (newSource: string) => void;
  onExecuteOnly: (newSource: string) => void;
}

export const CellEditor: React.FC<CellEditorProps> = ({
  cell,
  onSave,
  onCancel,
  onExecuteAndCreateNew,
  onExecuteOnly,
}) => {
  const [source, setSource] = useState(cell.source || "");
  const [cursorPosition, setCursorPosition] = useState(source.length);

  useEffect(() => {
    setSource(cell.source || "");
    setCursorPosition(cell.source?.length || 0);
  }, [cell.source]);

  useInput((input, key) => {
    // Debug: log key combinations to help troubleshoot (uncomment if needed)
    // console.log('Key pressed:', { input, key: Object.keys(key).filter(k => key[k]).join('+') });

    if (key.escape) {
      onSave(source);
      return;
    }

    if (key.ctrl && input.toLowerCase() === "c") {
      onCancel();
      return;
    }

    // Handle special key combinations first

    // Ctrl+R: Execute and create new cell (like Jupyter's Shift+Enter)
    if (key.ctrl && input.toLowerCase() === "r") {
      onExecuteAndCreateNew(source);
      return;
    }

    // Ctrl+E: Execute without creating new cell
    if (key.ctrl && input.toLowerCase() === "e") {
      onExecuteOnly(source);
      return;
    }

    // Handle Enter key
    if (key.return) {
      // Regular Enter: Add new line
      const newSource = source.slice(0, cursorPosition) +
        "\n" +
        source.slice(cursorPosition);
      setSource(newSource);
      setCursorPosition(cursorPosition + 1);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        const newSource = source.slice(0, cursorPosition - 1) +
          source.slice(cursorPosition);
        setSource(newSource);
        setCursorPosition(cursorPosition - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(Math.min(source.length, cursorPosition + 1));
      return;
    }

    if (key.upArrow) {
      // Move to beginning of current line or previous line
      const beforeCursor = source.slice(0, cursorPosition);
      const lastNewline = beforeCursor.lastIndexOf("\n");

      if (lastNewline === -1) {
        // Already on first line, go to beginning
        setCursorPosition(0);
      } else {
        // Find previous line
        const beforeLastNewline = beforeCursor.slice(0, lastNewline);
        const prevNewline = beforeLastNewline.lastIndexOf("\n");
        const prevLineStart = prevNewline === -1 ? 0 : prevNewline + 1;
        const currentLineStart = lastNewline + 1;
        const currentLineOffset = cursorPosition - currentLineStart;
        const prevLineLength = lastNewline - prevLineStart;

        setCursorPosition(
          prevLineStart + Math.min(currentLineOffset, prevLineLength),
        );
      }
      return;
    }

    if (key.downArrow) {
      // Move to next line at same column position if possible
      const beforeCursor = source.slice(0, cursorPosition);
      const afterCursor = source.slice(cursorPosition);
      const nextNewline = afterCursor.indexOf("\n");

      if (nextNewline === -1) {
        // Already on last line, go to end
        setCursorPosition(source.length);
      } else {
        // Find next line
        const currentLineStart = beforeCursor.lastIndexOf("\n") + 1;
        const currentLineOffset = cursorPosition - currentLineStart;
        const nextLineStart = cursorPosition + nextNewline + 1;
        const nextLineEnd = source.indexOf("\n", nextLineStart);
        const nextLineLength = nextLineEnd === -1
          ? source.length - nextLineStart
          : nextLineEnd - nextLineStart;

        setCursorPosition(
          nextLineStart + Math.min(currentLineOffset, nextLineLength),
        );
      }
      return;
    }

    // Handle regular character input
    if (input && !key.ctrl && !key.meta) {
      const newSource = source.slice(0, cursorPosition) +
        input +
        source.slice(cursorPosition);
      setSource(newSource);
      setCursorPosition(cursorPosition + input.length);
    }
  });

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

  // Split the source into lines for display
  const lines = source.split("\n");
  const displayLines = lines.map((line, lineIndex) => {
    if (lineIndex === lines.length - 1 && line === "") {
      // Don't show empty last line unless cursor is there
      const totalCharsBeforeLine = lines.slice(0, lineIndex).join("\n").length +
        (lineIndex > 0 ? 1 : 0);
      if (cursorPosition <= totalCharsBeforeLine) {
        return null;
      }
    }

    let displayLine = line;

    // Add cursor if it's on this line
    const charsBeforeLine = lines.slice(0, lineIndex).join("\n").length +
      (lineIndex > 0 ? 1 : 0);
    const charsAfterLine = charsBeforeLine + line.length;

    if (cursorPosition >= charsBeforeLine && cursorPosition <= charsAfterLine) {
      const positionInLine = cursorPosition - charsBeforeLine;
      displayLine = line.slice(0, positionInLine) +
        "│" +
        line.slice(positionInLine);
    }

    return displayLine;
  }).filter((line) => line !== null);

  return (
    <Box
      flexDirection="column"
      marginBottom={2}
      borderStyle="double"
      borderColor={Colors.UI.warning}
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
        marginBottom={1}
      >
        <Box flexDirection="row" alignItems="center">
          {/* @ts-expect-error - TUI Badge component in Ink */}
          <Badge color={getCellTypeColor(cell.cellType)}>
            {getCellTypeIcon(cell.cellType)} {cell.cellType}
          </Badge>
          <Box marginLeft={2}>
            <Text color={Colors.UI.warning}>✏️ EDITING</Text>
          </Box>
        </Box>

        <Box>
          <Text color={Colors.UI.metadata}>
            Ctrl+R: Run & Next • Ctrl+E: Run Only • ESC: Save • Ctrl+C: Cancel
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {displayLines.map((line, index) => (
          <Box key={index}>
            <Text wrap="wrap">{line}</Text>
          </Box>
        ))}
        {source === "" && (
          <Box>
            <Text color={Colors.UI.metadata}>│</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
