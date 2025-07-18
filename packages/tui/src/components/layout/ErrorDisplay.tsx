import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface ErrorDisplayProps {
  error: Error | string;
  title?: string;
  showStack?: boolean;
  onRetry?: () => void;
  centered?: boolean;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  title = "Error",
  showStack = false,
  onRetry,
  centered = true,
}) => {
  const errorMessage = typeof error === "string" ? error : error.message;
  const errorStack = typeof error === "string" ? null : error.stack;

  const content = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.UI.error}
      padding={1}
      minWidth={40}
    >
      <Box marginBottom={1}>
        <Text color={Colors.UI.error} bold>
          ❌ {title}
        </Text>
      </Box>

      <Box marginBottom={showStack || onRetry ? 1 : 0}>
        <Text color={Colors.UI.error} wrap="wrap">
          {errorMessage}
        </Text>
      </Box>

      {showStack && errorStack && (
        <Box marginBottom={onRetry ? 1 : 0}>
          <Text color={Colors.UI.metadata} wrap="wrap">
            {errorStack}
          </Text>
        </Box>
      )}

      {onRetry && (
        <Box>
          <Text color={Colors.UI.metadata}>
            Press{" "}
            <Text color={Colors.AccentCyan} bold>
              r
            </Text>{" "}
            to retry
          </Text>
        </Box>
      )}
    </Box>
  );

  if (centered) {
    return (
      <Box
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
      >
        {content}
      </Box>
    );
  }

  return content;
};
