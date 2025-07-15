import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface LoadingIndicatorProps {
  message?: string;
  showSpinner?: boolean;
  centered?: boolean;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = "Loading...",
  showSpinner = true,
  centered = true,
}) => {
  const [spinnerFrame, setSpinnerFrame] = React.useState(0);
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  React.useEffect(() => {
    if (!showSpinner) return;

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 80);

    return () => clearInterval(interval);
  }, [showSpinner, spinnerFrames.length]);

  const content = (
    <Box flexDirection="row" alignItems="center">
      {showSpinner && (
        <Text color={Colors.AccentCyan}>{spinnerFrames[spinnerFrame]}</Text>
      )}
      <Text color={Colors.UI.metadata}>{message}</Text>
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
