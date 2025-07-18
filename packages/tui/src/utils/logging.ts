import { Effect, Logger, LogLevel } from "effect";
import React, { createContext, useCallback, useContext, useState } from "react";
import type { PropsWithChildren } from "react";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel.LogLevel;
  message: string;
  id: string;
}

interface LoggingContextType {
  logs: LogEntry[];
  addLog: (level: LogLevel.LogLevel, message: string) => void;
  clearLogs: () => void;
  getRecentLogs: (count?: number) => LogEntry[];
  showLogs: boolean;
  toggleLogs: () => void;
}

const LoggingContext = createContext<LoggingContextType | null>(null);

export function useLogging() {
  const context = useContext(LoggingContext);
  if (!context) {
    throw new Error("useLogging must be used within a LoggingProvider");
  }
  return context;
}

type LoggingProviderProps = PropsWithChildren<{
  maxLogs?: number;
}>;

export function LoggingProvider(
  { children, maxLogs = 50 }: LoggingProviderProps,
) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const addLog = useCallback((level: LogLevel.LogLevel, message: string) => {
    const newLog: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      id: crypto.randomUUID(),
    };

    setLogs((prevLogs) => {
      const newLogs = [...prevLogs, newLog];
      // Keep only the most recent logs
      return newLogs.slice(-maxLogs);
    });
  }, [maxLogs]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const getRecentLogs = useCallback((count = 5) => {
    return logs.slice(-count);
  }, [logs]);

  const toggleLogs = useCallback(() => {
    setShowLogs((prev) => !prev);
  }, []);

  const value: LoggingContextType = {
    logs,
    addLog,
    clearLogs,
    getRecentLogs,
    showLogs,
    toggleLogs,
  };

  return React.createElement(
    LoggingContext.Provider,
    { value },
    children,
  );
}

// Custom Effect logger that integrates with React context
export function createTUILogger(
  addLog: (level: LogLevel.LogLevel, message: string) => void,
) {
  return Logger.make(({ logLevel, message }) => {
    addLog(logLevel, String(message));
  });
}

// Helper to get log level color for terminal display
export function getLogLevelColor(level: LogLevel.LogLevel): string {
  switch (level._tag) {
    case "Fatal":
    case "Error":
      return "red";
    case "Warning":
      return "yellow";
    case "Info":
      return "blue";
    case "Debug":
      return "gray";
    case "Trace":
      return "magenta";
    default:
      return "white";
  }
}

// Helper to format log level for display
export function formatLogLevel(level: LogLevel.LogLevel): string {
  return level.label.toUpperCase().padEnd(5);
}

// Helper to format timestamp for display
export function formatTimestamp(timestamp: Date): string {
  return timestamp.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
