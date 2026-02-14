"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createFrameBlobUrl } from "./frame-html";
import type {
  IframeToParentMessage,
  ParentToIframeMessage,
  RenderPayload,
} from "./frame-bridge";
import { isIframeMessage } from "./frame-bridge";

export interface IsolatedFrameProps {
  /**
   * Unique ID for this frame (used for message routing).
   */
  id?: string;

  /**
   * Initial content to render when the frame is ready.
   */
  initialContent?: RenderPayload;

  /**
   * Whether to use dark mode styling.
   */
  darkMode?: boolean;

  /**
   * Minimum height of the iframe in pixels.
   * @default 24
   */
  minHeight?: number;

  /**
   * Maximum height of the iframe in pixels.
   * @default 2000
   */
  maxHeight?: number;

  /**
   * Additional CSS classes for the iframe container.
   */
  className?: string;

  /**
   * Callback when the iframe is ready to receive messages.
   */
  onReady?: () => void;

  /**
   * Callback when the iframe content resizes.
   */
  onResize?: (height: number) => void;

  /**
   * Callback when a link is clicked in the iframe.
   */
  onLinkClick?: (url: string, newTab: boolean) => void;

  /**
   * Callback when a widget state update is sent from the iframe.
   */
  onWidgetUpdate?: (commId: string, state: Record<string, unknown>) => void;

  /**
   * Callback when an error occurs in the iframe.
   */
  onError?: (error: { message: string; stack?: string }) => void;

  /**
   * Callback for all messages from the iframe (for debugging or custom handling).
   */
  onMessage?: (message: IframeToParentMessage) => void;
}

export interface IsolatedFrameHandle {
  /**
   * Send a message to the iframe.
   */
  send: (message: ParentToIframeMessage) => void;

  /**
   * Send content to render in the iframe.
   */
  render: (payload: RenderPayload) => void;

  /**
   * Evaluate code in the iframe (for bootstrap/injection).
   */
  eval: (code: string) => void;

  /**
   * Update theme settings in the iframe.
   */
  setTheme: (isDark: boolean) => void;

  /**
   * Clear all content in the iframe.
   */
  clear: () => void;

  /**
   * Whether the iframe is ready to receive messages.
   */
  isReady: boolean;
}

/**
 * Sandbox attributes for the isolated iframe.
 *
 * CRITICAL: Do NOT include 'allow-same-origin' - this would give the iframe
 * access to the parent's origin and Tauri APIs.
 */
const SANDBOX_ATTRS = [
  "allow-scripts", // Required for rendering interactive content
  "allow-downloads", // Allow file downloads (e.g., from widgets)
  "allow-forms", // Allow form submissions
  "allow-pointer-lock", // For interactive visualizations
  "allow-popups", // Allow window.open (for links)
  "allow-popups-to-escape-sandbox", // Popups should be unrestricted
  "allow-modals", // Allow alert/confirm/prompt
].join(" ");

/**
 * IsolatedFrame component - Renders untrusted content in a secure iframe.
 *
 * Uses a blob: URL with sandbox restrictions to ensure the iframe content
 * cannot access Tauri APIs or the parent DOM. Communication happens via
 * postMessage.
 *
 * @example
 * ```tsx
 * const frameRef = useRef<IsolatedFrameHandle>(null);
 *
 * <IsolatedFrame
 *   ref={frameRef}
 *   darkMode={true}
 *   onReady={() => {
 *     frameRef.current?.render({
 *       mimeType: "text/html",
 *       data: "<h1>Hello from isolated frame!</h1>"
 *     });
 *   }}
 *   onResize={(height) => console.log("New height:", height)}
 * />
 * ```
 */
export const IsolatedFrame = forwardRef<IsolatedFrameHandle, IsolatedFrameProps>(
  function IsolatedFrame(
    {
      id,
      initialContent,
      darkMode = true,
      minHeight = 24,
      maxHeight = 2000,
      className = "",
      onReady,
      onResize,
      onLinkClick,
      onWidgetUpdate,
      onError,
      onMessage,
    },
    ref
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [height, setHeight] = useState(minHeight);

    // Queue messages until iframe is ready
    const pendingMessagesRef = useRef<ParentToIframeMessage[]>([]);

    // Create blob URL on mount
    useEffect(() => {
      const url = createFrameBlobUrl({ darkMode });
      setBlobUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    }, [darkMode]);

    // Send a message to the iframe
    const send = useCallback(
      (message: ParentToIframeMessage) => {
        if (!isReady) {
          // Queue message until ready
          pendingMessagesRef.current.push(message);
          return;
        }

        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(message, "*");
        }
      },
      [isReady]
    );

    // Flush pending messages when ready
    useEffect(() => {
      if (isReady && pendingMessagesRef.current.length > 0) {
        const pending = pendingMessagesRef.current;
        pendingMessagesRef.current = [];
        pending.forEach((msg) => {
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(msg, "*");
          }
        });
      }
    }, [isReady]);

    // Handle messages from iframe
    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        // Verify the message is from our iframe
        if (event.source !== iframeRef.current?.contentWindow) {
          return;
        }

        const data = event.data;
        if (!isIframeMessage(data)) {
          return;
        }

        // Call generic message handler
        onMessage?.(data);

        // Handle specific message types
        switch (data.type) {
          case "ready":
            setIsReady(true);
            onReady?.();
            // Render initial content if provided
            if (initialContent) {
              send({ type: "render", payload: initialContent });
            }
            break;

          case "resize":
            if (data.payload?.height != null) {
              const newHeight = Math.max(
                minHeight,
                Math.min(maxHeight, data.payload.height)
              );
              setHeight(newHeight);
              onResize?.(newHeight);
            }
            break;

          case "link_click":
            if (data.payload?.url) {
              onLinkClick?.(data.payload.url, data.payload.newTab ?? false);
            }
            break;

          case "widget_update":
            if (data.payload?.commId && data.payload?.state) {
              onWidgetUpdate?.(data.payload.commId, data.payload.state);
            }
            break;

          case "error":
            if (data.payload) {
              onError?.(data.payload);
            }
            break;
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [
      initialContent,
      minHeight,
      maxHeight,
      onReady,
      onResize,
      onLinkClick,
      onWidgetUpdate,
      onError,
      onMessage,
      send,
    ]);

    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        send,
        render: (payload: RenderPayload) => send({ type: "render", payload }),
        eval: (code: string) => send({ type: "eval", payload: { code } }),
        setTheme: (isDark: boolean) =>
          send({ type: "theme", payload: { isDark } }),
        clear: () => send({ type: "clear" }),
        isReady,
      }),
      [send, isReady]
    );

    if (!blobUrl) {
      return null;
    }

    return (
      <iframe
        ref={iframeRef}
        id={id}
        src={blobUrl}
        sandbox={SANDBOX_ATTRS}
        className={className}
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          display: "block",
        }}
        title="Isolated output frame"
      />
    );
  }
);
