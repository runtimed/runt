import React from "react";
import { Box, Text } from "ink";
import type { ErrorOutputData, OutputData } from "@runt/schema";
import { Colors } from "../../utils/colors.ts";
import { TerminalOutput } from "./TerminalOutput.tsx";
import { MultimediaOutput } from "./MultimediaOutput.tsx";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { CodeHighlighter } from "../../CodeHighlighter.tsx";
import { shouldRenderAsJson } from "../../utils/representationSelector.ts";

// Parse Python error from JSON format
function parsePythonError(data: unknown): string {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed.ename && parsed.evalue && parsed.traceback) {
        // Just return the traceback as-is, let terminal handle formatting
        return Array.isArray(parsed.traceback)
          ? parsed.traceback.join("")
          : String(parsed.traceback);
      }
    } catch (_e) {
      // If parsing fails, return original data
      return data;
    }
  }

  // Handle object format
  if (typeof data === "object" && data !== null) {
    const errorData = data as ErrorOutputData;
    if (errorData.ename && errorData.evalue && errorData.traceback) {
      return Array.isArray(errorData.traceback)
        ? errorData.traceback.join("")
        : String(errorData.traceback);
    }
    return JSON.stringify(data, null, 2);
  }

  return String(data);
}

interface OutputRendererProps {
  output: OutputData;
  showMetadata?: boolean;
  compact?: boolean;
}

export const OutputRenderer: React.FC<OutputRendererProps> = ({
  output,
  compact = false,
}) => {
  const renderOutputData = () => {
    switch (output.outputType) {
      case "terminal":
        return (
          <TerminalOutput
            data={output.data}
            isError={false}
            showTimestamp={!compact}
            timestamp={output.timestamp
              ? new Date(output.timestamp)
              : undefined}
          />
        );

      case "error":
        return (
          <TerminalOutput
            data={parsePythonError(output.data)}
            isError
            showTimestamp={!compact}
            timestamp={output.timestamp
              ? new Date(output.timestamp)
              : undefined}
          />
        );

      case "multimedia_display":
      case "multimedia_result":
        return <MultimediaOutput output={output} showMimeType={!compact} />;

      case "markdown":
        return (
          <MarkdownRenderer
            content={typeof output.data === "string"
              ? output.data
              : JSON.stringify(output.data)}
            compact={compact}
          />
        );

      case "execute_result":
        return (
          <Box paddingY={1}>
            {shouldRenderAsJson(output.data, output.mimeType)
              ? (
                <CodeHighlighter
                  code={JSON.stringify(output.data, null, 2)}
                  language="json"
                  showLineNumbers={false}
                />
              )
              : (
                <Text color={Colors.Output.execute_result} wrap="wrap">
                  {typeof output.data === "string"
                    ? output.data
                    : JSON.stringify(output.data)}
                </Text>
              )}
          </Box>
        );

      case "stream":
        return (
          <Box>
            {shouldRenderAsJson(output.data, output.mimeType)
              ? (
                <CodeHighlighter
                  code={JSON.stringify(output.data, null, 2)}
                  language="json"
                  showLineNumbers={false}
                />
              )
              : (
                <Text color={Colors.Output.stream} wrap="wrap">
                  {typeof output.data === "string"
                    ? output.data
                    : JSON.stringify(output.data)}
                </Text>
              )}
          </Box>
        );

      default:
        return (
          <Box>
            {shouldRenderAsJson(output.data, output.mimeType)
              ? (
                <CodeHighlighter
                  code={JSON.stringify(output.data, null, 2).slice(0, 300)}
                  language="json"
                  showLineNumbers={false}
                />
              )
              : (
                <Text color={Colors.UI.metadata} wrap="wrap">
                  {typeof output.data === "string"
                    ? output.data.slice(0, 300)
                    : JSON.stringify(output.data).slice(0, 300)}
                  {(typeof output.data === "string"
                        ? output.data.length
                        : JSON.stringify(output.data).length) > 300 && "..."}
                </Text>
              )}
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderOutputData()}
    </Box>
  );
};
