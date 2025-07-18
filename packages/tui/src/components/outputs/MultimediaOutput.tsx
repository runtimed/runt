import React from "react";
import { Box, Text } from "ink";
import type { MediaContainer } from "@runt/schema";
import { Colors } from "../../utils/colors.ts";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { CodeHighlighter } from "../../CodeHighlighter.tsx";
import {
  getUnsupportedContentMessage,
  isTerminalFriendly,
  processMultimediaOutput,
} from "../../utils/representationSelector.ts";

interface MultimediaOutputProps {
  output: {
    data: unknown;
    mimeType?: string;
    representations?: Record<string, MediaContainer>;
  };
  showMimeType?: boolean;
}

export const MultimediaOutput: React.FC<MultimediaOutputProps> = ({
  output,
  showMimeType = true,
}) => {
  // Process the output to get the best representation for terminal
  const processed = processMultimediaOutput(output);
  const { mimeType, data } = processed;
  const getMimeTypeColor = (mime: string) => {
    if (mime === "text/markdown") return Colors.AccentYellow;
    if (mime.includes("json")) return Colors.AccentGreen;
    return Colors.Output.multimedia;
  };

  const renderContent = () => {
    // Check if this is a terminal-friendly format
    if (!isTerminalFriendly(mimeType)) {
      return (
        <Box flexDirection="column" marginLeft={1}>
          <Text color={Colors.UI.metadata}>
            {getUnsupportedContentMessage(mimeType)}
          </Text>
        </Box>
      );
    }

    // Handle different MIME types
    switch (mimeType) {
      case "text/plain":
        return (
          <Text color={Colors.Output.terminal} wrap="wrap">
            {typeof data === "string" ? data : String(data)}
          </Text>
        );

      case "text/markdown":
        return (
          <Box flexDirection="column" marginLeft={1}>
            <MarkdownRenderer
              content={typeof data === "string" ? data : String(data)}
              compact={!showMimeType}
            />
          </Box>
        );

      case "application/json":
        return (
          <Box flexDirection="column" marginLeft={1}>
            <CodeHighlighter
              code={JSON.stringify(data, null, 2)}
              language="json"
              showLineNumbers={false}
            />
          </Box>
        );

      default:
        // Fallback for other terminal-friendly types
        return (
          <Box flexDirection="column" marginLeft={1}>
            <Text color={Colors.Output.terminal} wrap="wrap">
              {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
            </Text>
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column">
      {showMimeType && (
        <Box marginBottom={1}>
          <Text color={getMimeTypeColor(mimeType)}>{mimeType}</Text>
        </Box>
      )}
      {renderContent()}
    </Box>
  );
};
