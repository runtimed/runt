import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";
import {
  formatLogLevel,
  formatTimestamp,
  getLogLevelColor,
  useSimpleLogging,
} from "../../utils/simpleLogging.ts";

interface FooterProps {
  syncStatus: "connected" | "disconnected" | "syncing";
  lastSync?: Date;
  terminalWidth: number;
}

export const Footer: React.FC<FooterProps> = ({
  syncStatus,
  lastSync,
  terminalWidth,
}) => {
  const { getRecentLogs, showLogs } = useSimpleLogging();
  const recentLogs = showLogs ? getRecentLogs(8) : [];
  const getSyncStatusColor = () => {
    switch (syncStatus) {
      case "connected":
        return Colors.UI.success;
      case "syncing":
        return Colors.UI.warning;
      case "disconnected":
        return Colors.UI.error;
      default:
        return Colors.UI.metadata;
    }
  };

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "connected":
        return "● Connected";
      case "syncing":
        return "◐ Syncing";
      case "disconnected":
        return "○ Disconnected";
      default:
        return "○ Unknown";
    }
  };

  const formatLastSync = () => {
    if (!lastSync) return "";
    const now = new Date();
    const diff = now.getTime() - lastSync.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ago`;
    } else if (minutes > 0) {
      return `${minutes}m ago`;
    } else {
      return `${seconds}s ago`;
    }
  };

  const maxMessageLength = Math.max(20, terminalWidth - 25);

  return (
    <Box
      marginTop={1}
      flexDirection="column"
      width={terminalWidth}
      height={showLogs ? 10 : 3}
    >
      <Box>
        <Text color={Colors.UI.metadata}>
          ⚡ Debug Logs {showLogs ? "(L to hide)" : "(L to show)"}
        </Text>
      </Box>

      {showLogs && (
        <Box flexDirection="column" marginTop={1} height={8}>
          {recentLogs.length > 0
            ? (
              recentLogs.slice(0, 6).map((log) => (
                <Box key={log.id} flexDirection="row">
                  <Text color={Colors.UI.metadata}>
                    {formatTimestamp(log.timestamp)}
                  </Text>
                  <Text color={getLogLevelColor(log.level)} dimColor>
                    {" "}[{formatLogLevel(log.level)}]
                  </Text>
                  <Text color={Colors.UI.metadata}>
                    {" "}
                    {log.message.length > maxMessageLength
                      ? log.message.substring(0, maxMessageLength) + "..."
                      : log.message}
                  </Text>
                </Box>
              ))
            )
            : <Text color={Colors.UI.metadata} dimColor>No recent logs</Text>}
        </Box>
      )}

      {!showLogs && (
        <Box marginTop={1} height={8}>
          <Text color={Colors.UI.metadata} dimColor>
            Press L to show debug logs
          </Text>
        </Box>
      )}
    </Box>
  );
};
