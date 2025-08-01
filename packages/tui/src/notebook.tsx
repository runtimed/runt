import React, { useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { LiveStoreProvider } from "@livestore/react";
import { makeAdapter } from "@livestore/adapter-node";
import { makeCfSync } from "@livestore/sync-cf";
import { events, materializers, tables } from "@runt/schema";
import { makeSchema, State } from "@livestore/livestore";
import { useStore } from "@livestore/react";
import { NotebookRenderer } from "./components/notebook/NotebookRenderer.tsx";
import { LoadingIndicator } from "./components/layout/LoadingIndicator.tsx";
import { ErrorDisplay } from "./components/layout/ErrorDisplay.tsx";
import { Colors } from "./utils/colors.ts";
import { useExitHandler } from "./utils/useExitHandler.ts";
import { addLog } from "./utils/simpleLogging.ts";
import { LogLevel } from "effect";

// Create schema locally
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });

interface NotebookProps {
  notebookId: string;
}

const NotebookWrapper: React.FC<NotebookProps> = ({ notebookId }) => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);
  const presenceAnnouncedRef = useRef(false);
  const { exitApp } = useExitHandler({
    onExit: () => {
      addLog(LogLevel.Info, "Exiting due to fatal error...");
    },
  });

  const isValidNotebookId = (id: string): boolean => {
    return /^[a-zA-Z0-9\-_]+$/.test(id);
  };

  useEffect(() => {
    const cleanup = () => {
      addLog(LogLevel.Debug, "Cleaning up LiveStore connection...");
    };

    cleanupRef.current = cleanup;

    return cleanup;
  }, []);

  const syncUrl = Deno.env.get("LIVESTORE_SYNC_URL");
  const authToken = Deno.env.get("AUTH_TOKEN");

  if (!isValidNotebookId(notebookId)) {
    addLog(
      LogLevel.Error,
      `Fatal error: Invalid notebook ID '${notebookId}'. Only alphanumeric characters, hyphens, and underscores are allowed.`,
    );

    return (
      <ErrorDisplay
        error={`Invalid notebook ID: '${notebookId}'. Only alphanumeric characters, hyphens, and underscores are allowed.`}
        title="Invalid Notebook ID"
        centered
      />
    );
  }

  if (!syncUrl || !authToken) {
    addLog(
      LogLevel.Error,
      "Fatal configuration error: Missing required environment variables",
    );

    return (
      <ErrorDisplay
        error="LIVESTORE_SYNC_URL and AUTH_TOKEN must be set in environment"
        title="Configuration Error"
        centered
      />
    );
  }

  const adapter = makeAdapter({
    storage: { type: "in-memory" },
    sync: {
      backend: makeCfSync({ url: syncUrl }),
    },
  });

  const batchUpdates = (run: () => void) => {
    run();
  };

  useEffect(() => {
    const _handleExit = () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };

    return () => {
      // Cleanup will be handled by signal handlers
    };
  }, []);

  const renderLoading = () => (
    <LoadingIndicator message="Connecting to LiveStore..." />
  );

  const renderError = (error: Error) => {
    const now = Date.now();
    const timeSinceLastError = now - lastErrorTimeRef.current;

    // Reset counter if it's been more than 10 seconds since last error
    if (timeSinceLastError > 10000) {
      errorCountRef.current = 0;
    }

    errorCountRef.current += 1;
    lastErrorTimeRef.current = now;

    addLog(
      LogLevel.Error,
      `Fatal LiveStore error (${errorCountRef.current}): ${error.message}`,
    );

    // If we've had more than 3 errors in 10 seconds, exit to prevent loop
    if (errorCountRef.current > 3) {
      addLog(
        LogLevel.Error,
        "Too many LiveStore errors, exiting to prevent restart loop",
      );
      setTimeout(() => exitApp(), 1000);
    }

    return (
      <ErrorDisplay
        error={error}
        title="LiveStore Error"
        showStack={false}
        centered
      />
    );
  };

  const renderShutdown = (cause: { reason?: string }) => (
    <Box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <Box borderStyle="round" borderColor={Colors.UI.warning} padding={1}>
        <Text color={Colors.UI.warning}>
          ⚠️ LiveStore shutdown: {cause.reason || "unknown"}
        </Text>
      </Box>
    </Box>
  );

  return (
    <LiveStoreProvider
      schema={schema}
      adapter={adapter}
      storeId={notebookId}
      batchUpdates={batchUpdates}
      syncPayload={{
        authToken,
        runtime: true,
        clientId: "tui-client",
      }}
      renderLoading={renderLoading}
      renderError={renderError}
      renderShutdown={renderShutdown}
    >
      <NotebookWithPresence
        notebookId={notebookId}
        syncUrl={syncUrl}
        presenceAnnouncedRef={presenceAnnouncedRef}
      />
    </LiveStoreProvider>
  );
};

const NotebookWithPresence: React.FC<{
  notebookId: string;
  syncUrl: string;
  presenceAnnouncedRef: React.MutableRefObject<boolean>;
}> = ({ notebookId, syncUrl, presenceAnnouncedRef }) => {
  const { store } = useStore();

  // Announce presence when TUI connects
  React.useEffect(() => {
    if (!presenceAnnouncedRef.current && store) {
      addLog(LogLevel.Debug, "📍 Announcing TUI presence...");
      try {
        store.commit(
          events.presenceSet({
            userId: "tui-client",
            cellId: undefined, // TUI doesn't focus on specific cells
          }),
        );
        presenceAnnouncedRef.current = true;
        addLog(LogLevel.Debug, "✅ TUI presence announced");
      } catch (error) {
        addLog(LogLevel.Error, `❌ Failed to announce TUI presence: ${error}`);
      }
    }
  }, [store, presenceAnnouncedRef]);

  return (
    <NotebookRenderer
      notebookId={notebookId}
      syncUrl={syncUrl}
    />
  );
};

export const NotebookUI = NotebookWrapper;
