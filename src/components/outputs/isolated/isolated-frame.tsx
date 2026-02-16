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
   * Whether to bootstrap the React renderer bundle.
   * When true, fetches and evals the isolated-renderer bundle after the iframe is ready.
   * The bundle provides full React-based output rendering with MediaRouter support.
   * @default false
   */
  useReactRenderer?: boolean;

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
   * Callback when the user double-clicks in the iframe.
   */
  onDoubleClick?: () => void;

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
   * When useReactRenderer is true, this is true after the React bundle is initialized.
   * When useReactRenderer is false, this is true after the inline renderer is ready.
   */
  isReady: boolean;

  /**
   * Whether the iframe bootstrap HTML is loaded.
   * This is true before the React renderer bundle is loaded (if useReactRenderer is true).
   */
  isIframeReady: boolean;
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
/**
 * Cache for the renderer bundle to avoid re-fetching.
 */
let rendererBundleCache: string | null = null;
let rendererCssCache: string | null = null;

/**
 * Fetch the React renderer bundle and CSS.
 */
async function fetchRendererBundle(): Promise<{ js: string; css: string }> {
  if (rendererBundleCache && rendererCssCache) {
    return { js: rendererBundleCache, css: rendererCssCache };
  }

  const [jsResponse, cssResponse] = await Promise.all([
    fetch("/isolated/isolated-renderer.js"),
    fetch("/isolated/isolated-renderer.css"),
  ]);

  if (!jsResponse.ok) {
    throw new Error(`Failed to fetch renderer bundle: ${jsResponse.status}`);
  }
  if (!cssResponse.ok) {
    throw new Error(`Failed to fetch renderer CSS: ${cssResponse.status}`);
  }

  const [js, css] = await Promise.all([jsResponse.text(), cssResponse.text()]);

  rendererBundleCache = js;
  rendererCssCache = css;

  return { js, css };
}

export const IsolatedFrame = forwardRef<IsolatedFrameHandle, IsolatedFrameProps>(
  function IsolatedFrame(
    {
      id,
      initialContent,
      darkMode = true,
      useReactRenderer = false,
      minHeight = 24,
      maxHeight = 2000,
      className = "",
      onReady,
      onResize,
      onLinkClick,
      onDoubleClick,
      onWidgetUpdate,
      onError,
      onMessage,
    },
    ref
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    // Track iframe ready (bootstrap HTML loaded)
    const [isIframeReady, setIsIframeReady] = useState(false);
    // Track renderer ready (React bundle initialized, or inline renderer if not using React)
    const [isReady, setIsReady] = useState(false);
    // Use ref to track ready state for send callback (avoids stale closure)
    const isReadyRef = useRef(false);
    const [height, setHeight] = useState(minHeight);

    // Queue messages until iframe is ready
    const pendingMessagesRef = useRef<ParentToIframeMessage[]>([]);
    // Track if we've started bootstrapping to avoid double-fetch
    const bootstrappingRef = useRef(false);

    // Track initial darkMode for blob URL (don't recreate blob on theme change)
    const initialDarkModeRef = useRef(darkMode);

    // Create blob URL on mount (only once, with initial darkMode)
    useEffect(() => {
      const url = createFrameBlobUrl({ darkMode: initialDarkModeRef.current });
      setBlobUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    }, []);

    // Forward theme changes to iframe (without recreating the blob)
    useEffect(() => {
      if (isReady && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "theme", payload: { isDark: darkMode } },
          "*"
        );
      }
    }, [darkMode, isReady]);

    // Keep ref in sync with state (ref avoids stale closures in callbacks)
    useEffect(() => {
      isReadyRef.current = isReady;
    }, [isReady]);

    // Send a message to the iframe
    // Uses ref to check ready state to avoid stale closure issues
    const send = useCallback(
      (message: ParentToIframeMessage) => {
        if (!isReadyRef.current) {
          // Queue message until ready
          pendingMessagesRef.current.push(message);
          return;
        }

        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(message, "*");
        }
      },
      [] // No deps - uses ref instead of state
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
            // Iframe bootstrap HTML is loaded
            setIsIframeReady(true);

            if (useReactRenderer) {
              // Bootstrap the React renderer if not already doing so
              if (!bootstrappingRef.current) {
                bootstrappingRef.current = true;
                fetchRendererBundle()
                  .then(({ js, css }) => {
                    // Inject CSS first
                    const cssCode = `
                      (function() {
                        var style = document.createElement('style');
                        style.textContent = ${JSON.stringify(css)};
                        document.head.appendChild(style);
                      })();
                    `;
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: "eval", payload: { code: cssCode } },
                      "*"
                    );
                    // Then inject JS bundle
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: "eval", payload: { code: js } },
                      "*"
                    );
                  })
                  .catch((err) => {
                    console.error("[IsolatedFrame] Failed to load renderer:", err);
                    onError?.({ message: err.message });
                    // Fall back to inline renderer
                    setIsReady(true);
                    onReady?.();
                  });
              }
            } else {
              // Using inline renderer, mark as ready immediately
              setIsReady(true);
              onReady?.();
              // Render initial content if provided
              if (initialContent) {
                iframeRef.current?.contentWindow?.postMessage(
                  { type: "render", payload: initialContent },
                  "*"
                );
              }
            }
            break;

          case "renderer_ready":
            // React renderer bundle is initialized
            setIsReady(true);
            onReady?.();
            // Render initial content if provided
            if (initialContent) {
              iframeRef.current?.contentWindow?.postMessage(
                { type: "render", payload: initialContent },
                "*"
              );
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

          case "dblclick":
            onDoubleClick?.();
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
      useReactRenderer,
      onReady,
      onResize,
      onLinkClick,
      onDoubleClick,
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
        isIframeReady,
      }),
      [send, isReady, isIframeReady]
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
