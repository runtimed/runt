import React from "react";
import { LogLevel } from "effect";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel.LogLevel;
  message: string;
  id: string;
}

// Module-level state (outside React)
let logs: LogEntry[] = [];
let showLogs = false;
let maxLogs = 100;
let listeners: Array<() => void> = [];

// Simple event emitter for UI updates
function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function addLog(level: LogLevel.LogLevel, message: string) {
  const newLog: LogEntry = {
    timestamp: new Date(),
    level,
    message,
    id: crypto.randomUUID(),
  };

  logs = [...logs, newLog];

  // Keep only the most recent logs
  if (logs.length > maxLogs) {
    logs = logs.slice(-maxLogs);
  }

  notifyListeners();
}

export function toggleLogs() {
  showLogs = !showLogs;
  notifyListeners();
}

export function clearLogs() {
  logs = [];
  notifyListeners();
}

export function getRecentLogs(count = 5): LogEntry[] {
  return logs.slice(-count);
}

export function getShowLogs(): boolean {
  return showLogs;
}

export function setMaxLogs(max: number) {
  maxLogs = max;
}

// Hook for React components to subscribe to changes
export function useSimpleLogging() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    listeners.push(forceUpdate);

    return () => {
      listeners = listeners.filter((listener) => listener !== forceUpdate);
    };
  }, []);

  return {
    logs,
    showLogs,
    addLog,
    toggleLogs,
    clearLogs,
    getRecentLogs,
  };
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

// Create TUI logger for Effect integration
export function createSimpleTUILogger() {
  return {
    log: (args: { logLevel: LogLevel.LogLevel; message: unknown }) => {
      addLog(args.logLevel, String(args.message));
    },
  };
}
