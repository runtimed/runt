import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface TerminalOutputProps {
  data: string;
  isError?: boolean;
  showTimestamp?: boolean;
  timestamp?: Date;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({
  data,
  isError = false,
  showTimestamp = false,
  timestamp,
}) => {
  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const renderAnsiText = (text: string) => {
    // Basic ANSI color code handling
    // deno-lint-ignore no-control-regex
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    const cleanText = text.replace(ansiRegex, "");
    return cleanText;
  };

  const lines = data.split("\n");
  const color = isError ? Colors.Output.error : Colors.Output.terminal;

  return (
    <Box flexDirection="column" marginLeft={1}>
      {lines.map((line, index) => (
        <Box key={index} flexDirection="row">
          {showTimestamp && timestamp && index === 0 && (
            <Text color={Colors.UI.metadata}>
              [{formatTimestamp(timestamp)}]{" "}
            </Text>
          )}
          <Text color={color} wrap="wrap">
            {renderAnsiText(line)}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
