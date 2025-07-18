import React from "react";
import { Box, Text } from "ink";
import { Effect, Logger, LogLevel } from "effect";
import { NotebookUI } from "./notebook.tsx";
import { useExitHandler } from "./utils/useExitHandler.ts";
import { addLog } from "./utils/simpleLogging.ts";

type Props = {
  notebook: string | undefined;
};

function AppContent({ notebook }: Props) {
  const { ctrlCPressedOnce } = useExitHandler({
    onExit: () => {
      addLog(LogLevel.Info, "Notebook UI shutting down...");
    },
  });

  // Log startup once when component mounts
  React.useEffect(() => {
    addLog(LogLevel.Info, "TUI started");
    if (notebook) {
      addLog(LogLevel.Info, `Connecting to notebook: ${notebook}`);
    }
  }, [notebook]);

  if (notebook) {
    return (
      <Box flexDirection="column" height="100%">
        <NotebookUI notebookId={notebook} />
        {ctrlCPressedOnce && (
          <Box
            paddingX={1}
            paddingY={1}
            borderStyle="round"
            borderColor="yellow"
          >
            <Text color="yellow">Press Ctrl+C again to exit.</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height="100%"
    >
      <Text color="gray">Use --notebook flag to specify a notebook ID</Text>
      {ctrlCPressedOnce && (
        <Box marginTop={2}>
          <Text color="yellow">Press Ctrl+C again to exit.</Text>
        </Box>
      )}
    </Box>
  );
}

export default function App(props: Props) {
  return <AppContent {...props} />;
}
