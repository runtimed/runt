/**
 * HTML template generator for isolated output frames.
 *
 * Creates the minimal HTML document that runs inside the blob URL iframe.
 * This document handles the message protocol and provides a render target
 * for output content.
 *
 * Security: This code runs in an isolated origin (blob:) with sandbox
 * restrictions, so it cannot access Tauri APIs or the parent DOM.
 */

export interface FrameHtmlOptions {
  /**
   * Whether to include dark mode styles by default.
   */
  darkMode?: boolean;
  /**
   * Additional CSS to inject into the frame.
   */
  additionalCss?: string;
  /**
   * Additional JavaScript to inject (runs after bootstrap).
   */
  additionalScript?: string;
}

/**
 * Generate the HTML template for an isolated output frame.
 *
 * The generated HTML includes:
 * - Basic styling for outputs (respects light/dark mode)
 * - Message handler for parent communication
 * - ResizeObserver for auto-sizing
 * - Ready notification on load
 *
 * @param options - Configuration options for the frame
 * @returns HTML string to be used with a blob URL
 */
export function generateFrameHtml(options: FrameHtmlOptions = {}): string {
  const { darkMode = true, additionalCss = "", additionalScript = "" } = options;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' blob: data:; script-src 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src *;">
  <style>
    :root {
      --bg-primary: ${darkMode ? "#0a0a0a" : "#ffffff"};
      --bg-secondary: ${darkMode ? "#1a1a1a" : "#f5f5f5"};
      --text-primary: ${darkMode ? "#e0e0e0" : "#1a1a1a"};
      --text-secondary: ${darkMode ? "#a0a0a0" : "#666666"};
      --border-color: ${darkMode ? "#333333" : "#e0e0e0"};
      --accent-color: #3b82f6;
      --error-color: #ef4444;
      --success-color: #22c55e;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    body {
      padding: 8px;
    }

    /* Output container */
    #root {
      min-height: 1px;
    }

    /* Reset common elements */
    pre, code {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 13px;
    }

    pre {
      margin: 0;
      padding: 8px;
      background: var(--bg-secondary);
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    /* Table styling for pandas DataFrames */
    table {
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 13px;
    }

    th, td {
      border: 1px solid var(--border-color);
      padding: 4px 8px;
      text-align: left;
    }

    th {
      background: var(--bg-secondary);
      font-weight: 600;
    }

    /* Image outputs */
    img {
      max-width: 100%;
      height: auto;
    }

    /* Links */
    a {
      color: var(--accent-color);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    /* Error styling */
    .error {
      color: var(--error-color);
    }

    .error pre {
      background: ${darkMode ? "#1a1010" : "#fef2f2"};
      color: var(--error-color);
    }

    ${additionalCss}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function() {
      'use strict';

      // --- State ---
      let isReady = false;
      const root = document.getElementById('root');

      // --- Message Handler ---
      window.addEventListener('message', function(event) {
        // Only accept messages from our parent window
        if (event.source !== window.parent) {
          return;
        }

        const { type, payload } = event.data || {};

        try {
          switch (type) {
            case 'ping':
              handlePing(payload);
              break;

            case 'eval':
              handleEval(payload);
              break;

            case 'render':
              handleRender(payload);
              break;

            case 'theme':
              handleTheme(payload);
              break;

            case 'clear':
              handleClear();
              break;

            case 'widget_state':
              handleWidgetState(payload);
              break;

            default:
              console.warn('[frame] Unknown message type:', type);
          }
        } catch (err) {
          sendError(err);
        }
      });

      // --- Message Handlers ---

      function handlePing(payload) {
        send('pong', {
          receivedAt: Date.now(),
          echo: payload
        });
      }

      function handleEval(payload) {
        const { code } = payload || {};
        if (!code) {
          send('eval_result', { success: false, error: 'No code provided' });
          return;
        }

        // Store the current message for access during eval
        window.currentMessage = event;
        try {
          const result = eval.call(null, code);
          send('eval_result', { success: true, result: String(result ?? 'undefined') });
        } catch (err) {
          send('eval_result', { success: false, error: err.message });
        } finally {
          delete window.currentMessage;
        }
      }

      function handleRender(payload) {
        const { mimeType, data, metadata } = payload || {};

        if (mimeType === 'text/html') {
          // Use createContextualFragment for proper script execution
          const range = document.createRange();
          const fragment = range.createContextualFragment(String(data));
          root.innerHTML = '';
          root.appendChild(fragment);
        } else if (mimeType === 'text/plain') {
          const pre = document.createElement('pre');
          pre.textContent = String(data);
          root.innerHTML = '';
          root.appendChild(pre);
        } else if (mimeType && mimeType.startsWith('image/')) {
          const img = document.createElement('img');
          const imgData = String(data);
          // Check if it's base64 or a URL
          if (imgData.startsWith('data:') || imgData.startsWith('http')) {
            img.src = imgData;
          } else {
            img.src = 'data:' + mimeType + ';base64,' + imgData;
          }
          if (metadata?.width) img.width = metadata.width;
          if (metadata?.height) img.height = metadata.height;
          root.innerHTML = '';
          root.appendChild(img);
        } else {
          // Fallback: render as text
          const pre = document.createElement('pre');
          pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
          root.innerHTML = '';
          root.appendChild(pre);
        }

        // Notify completion
        requestAnimationFrame(function() {
          send('render_complete', { height: document.body.scrollHeight });
        });
      }

      function handleTheme(payload) {
        const { isDark, cssVariables } = payload || {};
        const rootEl = document.documentElement;

        if (isDark !== undefined) {
          rootEl.style.setProperty('--bg-primary', isDark ? '#0a0a0a' : '#ffffff');
          rootEl.style.setProperty('--bg-secondary', isDark ? '#1a1a1a' : '#f5f5f5');
          rootEl.style.setProperty('--text-primary', isDark ? '#e0e0e0' : '#1a1a1a');
          rootEl.style.setProperty('--text-secondary', isDark ? '#a0a0a0' : '#666666');
          rootEl.style.setProperty('--border-color', isDark ? '#333333' : '#e0e0e0');
        }

        if (cssVariables) {
          Object.entries(cssVariables).forEach(function([key, value]) {
            rootEl.style.setProperty(key, value);
          });
        }
      }

      function handleClear() {
        root.innerHTML = '';
        send('render_complete', { height: document.body.scrollHeight });
      }

      function handleWidgetState(payload) {
        // Widget state updates are handled by the injected renderer bundle
        // This is a placeholder that fires a custom event
        window.dispatchEvent(new CustomEvent('widget_state', { detail: payload }));
      }

      // --- Utilities ---

      function send(type, payload) {
        window.parent.postMessage({ type: type, payload: payload }, '*');
      }

      function sendError(err) {
        send('error', {
          message: err.message || String(err),
          stack: err.stack
        });
      }

      // --- Resize Observer ---
      const resizeObserver = new ResizeObserver(function(entries) {
        const height = document.body.scrollHeight;
        send('resize', { height: height });
      });
      resizeObserver.observe(document.body);

      // --- Link Click Interception ---
      document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (link && link.href) {
          e.preventDefault();
          send('link_click', {
            url: link.href,
            newTab: e.metaKey || e.ctrlKey
          });
        }
      });

      // --- Error Handler ---
      window.addEventListener('error', function(e) {
        sendError(e.error || new Error(e.message));
      });

      window.addEventListener('unhandledrejection', function(e) {
        sendError(e.reason || new Error('Unhandled promise rejection'));
      });

      // --- Additional Script ---
      ${additionalScript}

      // --- Ready Signal ---
      isReady = true;
      send('ready', null);
    })();
  </script>
</body>
</html>`;
}

/**
 * Create a blob URL from the frame HTML.
 *
 * @param options - Configuration options for the frame
 * @returns A blob: URL that can be used as iframe src
 */
export function createFrameBlobUrl(options?: FrameHtmlOptions): string {
  const html = generateFrameHtml(options);
  const blob = new Blob([html], { type: "text/html" });
  return URL.createObjectURL(blob);
}
