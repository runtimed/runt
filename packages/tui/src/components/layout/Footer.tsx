import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

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
      height={1}
    >
      <Box>
        <Text color={Colors.UI.metadata} dimColor>
          j/k Navigate • Enter Edit • r Run&Next • R RUN • a/b New • dd Del •
          SHIFT: A AI↑ • C Type • T Model
        </Text>
      </Box>
    </Box>
  );
};
