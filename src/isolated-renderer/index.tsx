/**
 * Isolated Renderer Entry Point
 *
 * This module runs inside an isolated iframe and renders Jupyter outputs
 * using React and the existing output components. It receives render
 * commands from the parent via postMessage and displays them.
 *
 * Security: This code runs in a sandboxed iframe with an opaque origin.
 * It cannot access Tauri APIs, the parent DOM, or localStorage.
 */

import { createRoot, type Root } from "react-dom/client";
import { StrictMode, useState, useEffect, useCallback } from "react";
// Import output components directly (not through MediaRouter's lazy loading)
// This ensures all components are bundled inline for the isolated iframe
import { AnsiOutput, AnsiErrorOutput, AnsiStreamOutput } from "@/components/outputs/ansi-output";
import { MarkdownOutput } from "@/components/outputs/markdown-output";
import { HtmlOutput } from "@/components/outputs/html-output";
import { ImageOutput } from "@/components/outputs/image-output";
import { SvgOutput } from "@/components/outputs/svg-output";
import { JsonOutput } from "@/components/outputs/json-output";
import type { RenderPayload } from "@/components/outputs/isolated/frame-bridge";

// --- Types ---

interface OutputEntry {
  id: string;
  payload: RenderPayload;
}

interface RendererState {
  outputs: OutputEntry[];
  isDark: boolean;
}

// --- Message Handling ---

type MessageHandler = (type: string, payload: unknown) => void;

let messageHandler: MessageHandler | null = null;

function setupMessageListener() {
  window.addEventListener("message", (event) => {
    // Only accept messages from parent
    if (event.source !== window.parent) return;

    const { type, payload } = event.data || {};
    if (messageHandler) {
      messageHandler(type, payload);
    }
  });
}

// --- React App ---

function IsolatedRendererApp() {
  const [state, setState] = useState<RendererState>({
    outputs: [],
    isDark: true,
  });

  // Handle messages from parent
  const handleMessage = useCallback((type: string, payload: unknown) => {
    switch (type) {
      case "render": {
        const renderPayload = payload as RenderPayload;
        const id = `output-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setState((prev) => ({
          ...prev,
          outputs: [...prev.outputs, { id, payload: renderPayload }],
        }));

        // Notify parent of render completion after next paint
        requestAnimationFrame(() => {
          window.parent.postMessage(
            {
              type: "render_complete",
              payload: { height: document.body.scrollHeight },
            },
            "*"
          );
        });
        break;
      }

      case "clear":
        setState((prev) => ({ ...prev, outputs: [] }));
        requestAnimationFrame(() => {
          window.parent.postMessage(
            {
              type: "render_complete",
              payload: { height: document.body.scrollHeight },
            },
            "*"
          );
        });
        break;

      case "theme": {
        const themePayload = payload as { isDark?: boolean };
        if (themePayload?.isDark !== undefined) {
          setState((prev) => ({ ...prev, isDark: themePayload.isDark! }));
          // Update CSS variables
          const root = document.documentElement;
          if (themePayload.isDark) {
            root.style.setProperty("--bg-primary", "#0a0a0a");
            root.style.setProperty("--bg-secondary", "#1a1a1a");
            root.style.setProperty("--text-primary", "#e0e0e0");
            root.style.setProperty("--text-secondary", "#a0a0a0");
          } else {
            root.style.setProperty("--bg-primary", "#ffffff");
            root.style.setProperty("--bg-secondary", "#f5f5f5");
            root.style.setProperty("--text-primary", "#1a1a1a");
            root.style.setProperty("--text-secondary", "#666666");
          }
        }
        break;
      }
    }
  }, []);

  // Register message handler
  useEffect(() => {
    messageHandler = handleMessage;
    return () => {
      messageHandler = null;
    };
  }, [handleMessage]);

  return (
    <div className="isolated-renderer" data-theme={state.isDark ? "dark" : "light"}>
      {state.outputs.map((entry) => (
        <OutputRenderer key={entry.id} payload={entry.payload} />
      ))}
    </div>
  );
}

/**
 * Render a single output based on its MIME type.
 * Uses direct component imports (not lazy loading) for isolated iframe compatibility.
 */
function OutputRenderer({ payload }: { payload: RenderPayload }) {
  const { mimeType, data, metadata } = payload;
  const content = data;

  // Handle stream output (plain text with potential ANSI)
  if (mimeType === "text/plain" && metadata?.streamName) {
    return (
      <AnsiStreamOutput
        text={String(data)}
        streamName={metadata.streamName as "stdout" | "stderr"}
      />
    );
  }

  // Handle error output
  if (mimeType === "text/plain" && metadata?.isError) {
    return (
      <AnsiErrorOutput
        ename={String(metadata.ename || "Error")}
        evalue={String(metadata.evalue || "")}
        traceback={
          Array.isArray(metadata.traceback)
            ? metadata.traceback.map(String)
            : [String(data)]
        }
      />
    );
  }

  // Route to appropriate component based on MIME type
  // (Direct rendering without MediaRouter's lazy loading)

  // Markdown
  if (mimeType === "text/markdown") {
    return <MarkdownOutput content={String(content)} unsafe={true} />;
  }

  // HTML
  if (mimeType === "text/html") {
    return <HtmlOutput content={String(content)} unsafe={true} />;
  }

  // SVG
  if (mimeType === "image/svg+xml") {
    return <SvgOutput content={String(content)} />;
  }

  // Images (PNG, JPEG, GIF, WebP)
  if (mimeType.startsWith("image/")) {
    return (
      <ImageOutput
        data={content}
        mimeType={mimeType}
        metadata={metadata as Record<string, unknown>}
      />
    );
  }

  // JSON
  if (mimeType === "application/json") {
    const jsonData = typeof content === "string" ? JSON.parse(content) : content;
    return <JsonOutput data={jsonData} />;
  }

  // Plain text / ANSI
  if (mimeType === "text/plain") {
    return <AnsiOutput text={String(content)} />;
  }

  // Fallback: render as plain text
  return (
    <pre style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
      {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
    </pre>
  );
}

// --- Bootstrap ---

let root: Root | null = null;

/**
 * Initialize the renderer. Called when the bundle is eval'd in the iframe.
 */
export function init() {
  // Set up message listener
  setupMessageListener();

  // Create root element if needed
  let rootEl = document.getElementById("root");
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "root";
    document.body.appendChild(rootEl);
  }

  // Create React root and render
  root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <IsolatedRendererApp />
    </StrictMode>
  );

  // Set up resize observer
  const resizeObserver = new ResizeObserver(() => {
    window.parent.postMessage(
      { type: "resize", payload: { height: document.body.scrollHeight } },
      "*"
    );
  });
  resizeObserver.observe(document.body);

  // Notify parent that renderer is ready
  window.parent.postMessage({ type: "renderer_ready" }, "*");
}

// Auto-init if this is the main module being eval'd
// The parent will send us via eval, so we auto-start
if (typeof window !== "undefined") {
  // Check if we're being eval'd (window.currentMessage exists from bootstrap)
  // If so, init immediately. Otherwise, export for manual init.
  init();
}
