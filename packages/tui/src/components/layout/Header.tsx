import React from "react";
import { Box, Text } from "ink";
import Link from "ink-link";
import { Colors } from "../../utils/colors.ts";

interface HeaderProps {
  title: string;
  notebookId: string;
  cellCount: number;
  terminalWidth: number;
  syncUrl?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  notebookId,
  cellCount,
  terminalWidth,
  syncUrl,
}) => {
  const getWebNotebookUrl = () => {
    if (!syncUrl) return null;

    if (syncUrl.includes("localhost") || syncUrl.includes("127.0.0.1")) {
      return `${syncUrl}?notebook=${notebookId}`;
    }

    try {
      const url = new URL(syncUrl);
      if (url.protocol === "wss:") {
        url.protocol = "https:";
      } else if (url.protocol === "ws:") {
        url.protocol = "http:";
      }
      url.hostname = url.hostname.replace("sync.", "app.");
      return `${url.origin}?notebook=${notebookId}`;
    } catch {
      return `https://app.runt.run?notebook=${notebookId}`;
    }
  };

  const webUrl = getWebNotebookUrl();

  return (
    <Box
      width={terminalWidth}
      marginBottom={1}
      flexDirection="column"
    >
      <Box justifyContent="space-between" alignItems="center">
        <Text color={Colors.UI.title} bold>
          {title}
        </Text>
        <Text color={Colors.UI.success}>● Connected</Text>
      </Box>
      {webUrl && (
        <Box>
          <Link url={webUrl}>
            <Text color={Colors.AccentCyan}>
              {webUrl}
            </Text>
          </Link>
        </Box>
      )}
    </Box>
  );
};
