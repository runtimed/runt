// Test harness for development
export { IsolationTest } from "./IsolationTest";

// Production components
export { IsolatedFrame } from "./isolated-frame";
export type { IsolatedFrameProps, IsolatedFrameHandle } from "./isolated-frame";

// HTML template generator
export { generateFrameHtml, createFrameBlobUrl } from "./frame-html";
export type { FrameHtmlOptions } from "./frame-html";

// Message protocol types
export type {
  // Parent → Iframe
  ParentToIframeMessage,
  EvalMessage,
  RenderMessage,
  RenderPayload,
  WidgetStateMessage,
  ThemeMessage,
  PingMessage,
  ClearMessage,
  // Iframe → Parent
  IframeToParentMessage,
  ReadyMessage,
  PongMessage,
  EvalResultMessage,
  RenderCompleteMessage,
  ResizeMessage,
  LinkClickMessage,
  WidgetUpdateMessage,
  IframeErrorMessage,
  // Utilities
  IframeMessage,
  MessageType,
} from "./frame-bridge";
export { isIframeMessage, isMessageType } from "./frame-bridge";

// Widget comm bridge for isolated frames
export { CommBridgeManager, createCommBridgeManager } from "./comm-bridge-manager";
