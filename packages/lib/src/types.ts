// Type definitions for Anode runtime agents
//
// This module provides TypeScript interfaces and types used throughout
// the runtime agent library, importing existing types from @runt/schema
// and adding runtime-specific extensions.

import type { Store } from "npm:@livestore/livestore";
import type {
  CellData,
  ExecutionQueueData,
  OutputType,
  RichOutputData,
  schema,
} from "@runt/schema";

/**
 * Configuration options for runtime agents
 */
export interface RuntimeAgentOptions {
  /** Unique identifier for this kernel */
  kernelId: string;
  /** Human-readable kernel type (appears in UI) */
  kernelType: string;
  /** Capabilities this kernel supports */
  capabilities: KernelCapabilities;
  /** LiveStore sync URL */
  syncUrl: string;
  /** Authentication token */
  authToken: string;
  /** Notebook ID to connect to */
  notebookId: string;
  /** Heartbeat interval in milliseconds (default: 15000) */
  heartbeatInterval?: number;
}

/**
 * Capabilities that a kernel can advertise to the notebook UI
 * (extracted from existing schema capabilities structure)
 */
export interface KernelCapabilities {
  /** Can execute code cells */
  canExecuteCode: boolean;
  /** Can execute SQL cells */
  canExecuteSql: boolean;
  /** Can execute AI cells */
  canExecuteAi: boolean;
}

/**
 * Execution context passed to handlers
 */
export interface ExecutionContext {
  /** The cell being executed */
  cell: CellData;
  /** The execution queue entry */
  queueEntry: ExecutionQueueData;
  /** LiveStore instance */
  store: Store<typeof schema>;
  /** This kernel's session ID */
  sessionId: string;
  /** Kernel ID */
  kernelId: string;

  /** AbortSignal for cancellation support */
  abortSignal: AbortSignal;
  /** Helper to check if execution should be cancelled */
  checkCancellation: () => void;

  // Output emission methods for real-time streaming
  /** Emit text to stdout stream */
  stdout: (text: string) => void;
  /** Emit text to stderr stream */
  stderr: (text: string) => void;
  /** Emit rich display data (plots, HTML, etc.) */
  display: (
    data: RichOutputData,
    metadata?: Record<string, unknown>,
    displayId?: string,
  ) => void;
  /** Update existing display data by display ID */
  updateDisplay: (
    displayId: string,
    data: RichOutputData,
    metadata?: Record<string, unknown>,
  ) => void;
  /** Emit execution result (final output) */
  result: (
    data: RichOutputData,
    metadata?: Record<string, unknown>,
  ) => void;
  /** Emit error output */
  error: (ename: string, evalue: string, traceback: string[]) => void;
  /** Clear all previous outputs for this cell */
  clear: () => void;
}

/**
 * Result of cell execution
 *
 * Note: With streaming output support, most outputs should be emitted
 * via ExecutionContext methods (emitStream, emitDisplay, etc.) during
 * execution. This result primarily indicates final success/failure state.
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Optional final output data (for simple cases) */
  data?: RichOutputData;
  /** Optional metadata for final output */
  metadata?: Record<string, unknown>;
  /** Error message if execution failed */
  error?: string;
  /** Output type for final data (default: "execute_result") */
  outputType?: OutputType;
}

/**
 * Function signature for execution handlers
 *
 * Handlers should use the ExecutionContext methods to emit outputs in real-time:
 * - context.stdout() / context.stderr() for streaming text output
 * - context.display() for rich displays (plots, HTML, etc.)
 * - context.result() for final execution results
 * - context.error() for errors
 * - context.clear() to clear previous outputs
 *
 * The returned ExecutionResult indicates overall success/failure and can
 * optionally include final output data for simple cases.
 *
 * @param context - Execution context with cell, store, and output methods
 * @returns Promise resolving to execution result (success/failure state)
 */
export type ExecutionHandler = (
  context: ExecutionContext,
) => Promise<ExecutionResult>;

/**
 * Event handlers for runtime agent lifecycle
 */
export interface RuntimeAgentEventHandlers {
  /** Called when agent starts up */
  onStartup?: () => void | Promise<void>;
  /** Called when agent shuts down */
  onShutdown?: () => void | Promise<void>;
  /** Called when connection to LiveStore is established */
  onConnected?: () => void | Promise<void>;
  /** Called when connection to LiveStore is lost */
  onDisconnected?: (error?: Error) => void | Promise<void>;
  /** Called when an execution fails */
  onExecutionError?: (
    error: Error,
    context: ExecutionContext,
  ) => void | Promise<void>;
}

/**
 * Cancellation error for when execution is interrupted
 */
export interface CancellationError extends Error {
  name: "CancellationError";
  queueId: string;
  cellId: string;
}

/**
 * Handler for execution cancellation events
 */
export type CancellationHandler = (
  queueId: string,
  cellId: string,
  reason: string,
) => void | Promise<void>;

/**
 * Runtime agent status
 */
export type AgentStatus =
  | "starting"
  | "ready"
  | "busy"
  | "error"
  | "shutting-down";

// Re-export commonly used schema types for convenience
export type {
  CellData,
  ErrorOutputData,
  ExecutionQueueData,
  KernelSessionData,
  OutputType,
  RichOutputData,
  StreamOutputData,
} from "@runt/schema";
