/**
 * Message protocol types for parent ↔ iframe communication.
 *
 * This module defines the contract between the parent window and isolated output frames.
 * All communication happens via postMessage with structured message types.
 */

// --- Message Types: Parent → Iframe ---

/**
 * Bootstrap the iframe with JavaScript code (Colab-style eval pattern).
 * Used to inject the ESM renderer bundle into the iframe.
 */
export interface EvalMessage {
  type: "eval";
  payload: {
    /** JavaScript code to evaluate in the iframe context */
    code: string;
  };
}

/**
 * Render output content in the iframe.
 */
export interface RenderMessage {
  type: "render";
  payload: RenderPayload;
}

export interface RenderPayload {
  /** MIME type of the content (e.g., "text/html", "text/markdown") */
  mimeType: string;
  /** The content data (format depends on MIME type) */
  data: unknown;
  /** Optional metadata for the output */
  metadata?: Record<string, unknown>;
  /** Cell ID this output belongs to (for routing) */
  cellId?: string;
  /** Output index within the cell */
  outputIndex?: number;
}

/**
 * Update widget state in the iframe.
 */
export interface WidgetStateMessage {
  type: "widget_state";
  payload: {
    /** Comm ID of the widget */
    commId: string;
    /** Updated state to merge */
    state: Record<string, unknown>;
    /** Optional buffers (base64 encoded) */
    buffers?: string[];
  };
}

/**
 * Sync theme with the iframe.
 */
export interface ThemeMessage {
  type: "theme";
  payload: {
    /** Whether dark mode is active */
    isDark: boolean;
    /** Optional CSS variables to inject */
    cssVariables?: Record<string, string>;
  };
}

/**
 * Ping the iframe (for health checks and latency measurement).
 */
export interface PingMessage {
  type: "ping";
  payload?: {
    sentAt: number;
  };
}

/**
 * Clear all rendered content in the iframe.
 */
export interface ClearMessage {
  type: "clear";
}

/**
 * All message types that can be sent from parent to iframe.
 */
export type ParentToIframeMessage =
  | EvalMessage
  | RenderMessage
  | WidgetStateMessage
  | ThemeMessage
  | PingMessage
  | ClearMessage;

// --- Message Types: Iframe → Parent ---

/**
 * Iframe has finished loading and is ready to receive messages.
 */
export interface ReadyMessage {
  type: "ready";
}

/**
 * Response to a ping message.
 */
export interface PongMessage {
  type: "pong";
  payload: {
    receivedAt: number;
    /** Echo back the payload from the ping */
    echo?: unknown;
  };
}

/**
 * Result of evaluating code in the iframe.
 */
export interface EvalResultMessage {
  type: "eval_result";
  payload: {
    success: boolean;
    result?: string;
    error?: string;
  };
}

/**
 * Iframe content has finished rendering.
 */
export interface RenderCompleteMessage {
  type: "render_complete";
  payload?: {
    /** Height of the rendered content */
    height?: number;
  };
}

/**
 * Iframe content size has changed.
 */
export interface ResizeMessage {
  type: "resize";
  payload: {
    /** New height of the content */
    height: number;
    /** New width of the content (optional) */
    width?: number;
  };
}

/**
 * User clicked a link in the iframe.
 */
export interface LinkClickMessage {
  type: "link_click";
  payload: {
    /** The URL that was clicked */
    url: string;
    /** Whether it was a ctrl/cmd click */
    newTab: boolean;
  };
}

/**
 * Widget state was updated in the iframe (needs to sync to kernel).
 */
export interface WidgetUpdateMessage {
  type: "widget_update";
  payload: {
    /** Comm ID of the widget */
    commId: string;
    /** Updated state */
    state: Record<string, unknown>;
    /** Optional buffers (base64 encoded) */
    buffers?: string[];
  };
}

/**
 * An error occurred in the iframe.
 */
export interface IframeErrorMessage {
  type: "error";
  payload: {
    message: string;
    stack?: string;
  };
}

/**
 * All message types that can be sent from iframe to parent.
 */
export type IframeToParentMessage =
  | ReadyMessage
  | PongMessage
  | EvalResultMessage
  | RenderCompleteMessage
  | ResizeMessage
  | LinkClickMessage
  | WidgetUpdateMessage
  | IframeErrorMessage;

// --- Utility Types ---

/**
 * All message types (for generic handling).
 */
export type IframeMessage = ParentToIframeMessage | IframeToParentMessage;

/**
 * Extract the message type string.
 */
export type MessageType = IframeMessage["type"];

/**
 * Type guard to check if a message is from the iframe.
 */
export function isIframeMessage(data: unknown): data is IframeToParentMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as { type?: unknown };
  return (
    typeof msg.type === "string" &&
    ["ready", "pong", "eval_result", "render_complete", "resize", "link_click", "widget_update", "error"].includes(
      msg.type
    )
  );
}

/**
 * Type guard for specific message types.
 */
export function isMessageType<T extends IframeMessage["type"]>(
  data: unknown,
  type: T
): data is Extract<IframeMessage, { type: T }> {
  if (typeof data !== "object" || data === null) return false;
  return (data as { type?: unknown }).type === type;
}
