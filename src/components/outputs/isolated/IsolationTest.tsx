"use client";

import { useEffect, useRef, useState } from "react";
import { IsolatedFrame, type IsolatedFrameHandle } from "./isolated-frame";

/**
 * Test results from the isolated iframe
 */
interface IsolationTestResult {
  hasTauri: boolean;
  hasInvoke: boolean;
  canAccessParentDocument: boolean;
  canAccessParentLocalStorage: boolean;
  windowOrigin: string;
  error?: string;
}

/**
 * HTML template for the isolation test iframe.
 * This runs inside the iframe and reports back via postMessage.
 * Also handles bidirectional communication (ping/pong, eval, render).
 */
const ISOLATION_TEST_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: system-ui, sans-serif;
      padding: 16px;
      margin: 0;
      background: #1a1a1a;
      color: #e0e0e0;
    }
    .test-item {
      padding: 8px;
      margin: 4px 0;
      border-radius: 4px;
    }
    .pass { background: #1e3a1e; color: #4ade80; }
    .fail { background: #3a1e1e; color: #f87171; }
    .info { background: #1e2a3a; color: #60a5fa; }
    pre { font-size: 12px; overflow: auto; }
    #render-target { margin-top: 16px; padding: 8px; border: 1px dashed #444; min-height: 20px; }
  </style>
</head>
<body>
  <h3>Iframe Isolation Test</h3>
  <div id="results"></div>
  <div id="messages"></div>
  <div id="render-target"></div>
  <script>
    const results = {
      hasTauri: false,
      hasInvoke: false,
      canAccessParentDocument: false,
      canAccessParentLocalStorage: false,
      windowOrigin: window.origin || 'null',
      error: null
    };

    // Test 1: Check for window.__TAURI__
    try {
      results.hasTauri = typeof window.__TAURI__ !== 'undefined';
    } catch (e) {
      results.hasTauri = false;
    }

    // Test 2: Check for invoke function
    try {
      results.hasInvoke = typeof window.__TAURI_INTERNALS__?.invoke === 'function' ||
                          typeof window.__TAURI__?.core?.invoke === 'function';
    } catch (e) {
      results.hasInvoke = false;
    }

    // Test 3: Try to access parent document
    try {
      const test = window.parent.document.body;
      results.canAccessParentDocument = true;
    } catch (e) {
      results.canAccessParentDocument = false;
    }

    // Test 4: Try to access parent localStorage
    try {
      const test = window.parent.localStorage.getItem('test');
      results.canAccessParentLocalStorage = true;
    } catch (e) {
      results.canAccessParentLocalStorage = false;
    }

    // Display results in iframe
    const container = document.getElementById('results');
    const tests = [
      { name: 'window.__TAURI__ exists', value: results.hasTauri, expectFalse: true },
      { name: 'invoke() accessible', value: results.hasInvoke, expectFalse: true },
      { name: 'Can access parent document', value: results.canAccessParentDocument, expectFalse: true },
      { name: 'Can access parent localStorage', value: results.canAccessParentLocalStorage, expectFalse: true },
    ];

    tests.forEach(test => {
      const pass = test.expectFalse ? !test.value : test.value;
      const div = document.createElement('div');
      div.className = 'test-item ' + (pass ? 'pass' : 'fail');
      div.textContent = (pass ? '✓ ' : '✗ ') + test.name + ': ' + test.value;
      container.appendChild(div);
    });

    const originDiv = document.createElement('div');
    originDiv.className = 'test-item';
    originDiv.innerHTML = '<pre>Window origin: ' + results.windowOrigin + '</pre>';
    container.appendChild(originDiv);

    // Send results to parent
    window.parent.postMessage({ type: 'isolation_test_result', results }, '*');

    // --- Bidirectional Communication ---
    const messagesContainer = document.getElementById('messages');
    const renderTarget = document.getElementById('render-target');

    function logMessage(text, type = 'info') {
      const div = document.createElement('div');
      div.className = 'test-item ' + type;
      div.textContent = text;
      messagesContainer.appendChild(div);
    }

    // Listen for messages from parent
    window.addEventListener('message', function(event) {
      // Only accept messages from our parent window
      if (event.source !== window.parent) {
        return;
      }

      const { type, payload } = event.data || {};

      switch (type) {
        case 'ping':
          // Respond to ping with pong
          logMessage('Received ping, sending pong...', 'info');
          window.parent.postMessage({
            type: 'pong',
            payload: {
              receivedAt: Date.now(),
              echo: payload
            }
          }, '*');
          break;

        case 'eval':
          // Bootstrap/eval pattern (like Colab)
          logMessage('Received eval command', 'info');
          window.currentMessage = event;
          try {
            const result = eval.call(null, payload.code);
            window.parent.postMessage({
              type: 'eval_result',
              payload: { success: true, result: String(result) }
            }, '*');
          } catch (e) {
            window.parent.postMessage({
              type: 'eval_result',
              payload: { success: false, error: e.message }
            }, '*');
          } finally {
            delete window.currentMessage;
          }
          break;

        case 'render':
          // Render HTML content
          logMessage('Received render command: ' + payload.mimeType, 'info');
          if (payload.mimeType === 'text/html') {
            const range = document.createRange();
            const fragment = range.createContextualFragment(payload.data);
            renderTarget.innerHTML = '';
            renderTarget.appendChild(fragment);
            window.parent.postMessage({ type: 'render_complete' }, '*');
          }
          break;

        default:
          logMessage('Unknown message type: ' + type, 'fail');
      }
    });

    // Notify parent that iframe is ready for communication
    window.parent.postMessage({ type: 'ready' }, '*');
  </script>
</body>
</html>`;

/**
 * IsolationTest component - A proof-of-concept to verify that blob URL iframes
 * are properly isolated from Tauri's IPC injection.
 *
 * This component creates an iframe using a blob: URL with sandbox attributes
 * that should prevent access to Tauri APIs while still allowing script execution.
 *
 * Expected results for proper isolation:
 * - window.__TAURI__ should be undefined
 * - invoke() should not be accessible
 * - Parent document should not be accessible
 * - Parent localStorage should not be accessible
 */
/**
 * Communication test state
 */
interface CommTestState {
  iframeReady: boolean;
  pingCount: number;
  lastPongTime: number | null;
  evalResult: string | null;
  renderComplete: boolean;
}

export function IsolationTest() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<IsolationTestResult | null>(null);
  const [parentHasTauri, setParentHasTauri] = useState<boolean>(false);
  const [commState, setCommState] = useState<CommTestState>({
    iframeReady: false,
    pingCount: 0,
    lastPongTime: null,
    evalResult: null,
    renderComplete: false,
  });

  // Check if parent has Tauri (for comparison)
  useEffect(() => {
    setParentHasTauri(typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined");
  }, []);

  // Create blob URL on mount
  useEffect(() => {
    const blob = new Blob([ISOLATION_TEST_HTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, []);

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type, payload } = event.data || {};

      switch (type) {
        case "isolation_test_result":
          setTestResult(payload ?? event.data.results);
          break;
        case "ready":
          setCommState((prev) => ({ ...prev, iframeReady: true }));
          break;
        case "pong":
          setCommState((prev) => ({
            ...prev,
            pingCount: prev.pingCount + 1,
            lastPongTime: payload?.receivedAt ?? Date.now(),
          }));
          break;
        case "eval_result":
          setCommState((prev) => ({
            ...prev,
            evalResult: payload?.success
              ? `Success: ${payload.result}`
              : `Error: ${payload?.error}`,
          }));
          break;
        case "render_complete":
          setCommState((prev) => ({ ...prev, renderComplete: true }));
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Send message to iframe
  const sendToIframe = (type: string, payload?: unknown) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type, payload }, "*");
    }
  };

  const handlePing = () => {
    sendToIframe("ping", { sentAt: Date.now() });
  };

  const handleEval = () => {
    sendToIframe("eval", { code: "1 + 2 + 3" });
  };

  const handleRender = () => {
    setCommState((prev) => ({ ...prev, renderComplete: false }));
    sendToIframe("render", {
      mimeType: "text/html",
      data: "<div style='color: #4ade80; padding: 8px;'>✓ HTML rendered via postMessage!</div>",
    });
  };

  const isIsolated =
    testResult &&
    !testResult.hasTauri &&
    !testResult.hasInvoke &&
    !testResult.canAccessParentDocument &&
    !testResult.canAccessParentLocalStorage;

  return (
    <div className="p-4 space-y-4 bg-background text-foreground">
      <h2 className="text-lg font-semibold">Blob URL Iframe Isolation Test</h2>

      {/* Parent context info */}
      <div className="p-3 rounded bg-muted">
        <h3 className="font-medium mb-2">Parent Window Context:</h3>
        <p className="text-sm">
          window.__TAURI__ exists:{" "}
          <span className={parentHasTauri ? "text-yellow-500" : "text-green-500"}>
            {parentHasTauri ? "Yes (expected in Tauri app)" : "No"}
          </span>
        </p>
        <p className="text-sm">
          Window origin: <code className="text-xs">{window.origin}</code>
        </p>
      </div>

      {/* Test results */}
      {testResult && (
        <div
          className={`p-3 rounded ${
            isIsolated ? "bg-green-950 border border-green-700" : "bg-red-950 border border-red-700"
          }`}
        >
          <h3 className="font-medium mb-2">
            {isIsolated ? "✓ Iframe is properly isolated!" : "✗ Isolation FAILED"}
          </h3>
          <ul className="text-sm space-y-1">
            <li>
              Tauri API blocked:{" "}
              <span className={!testResult.hasTauri ? "text-green-500" : "text-red-500"}>
                {!testResult.hasTauri ? "Yes ✓" : "No ✗"}
              </span>
            </li>
            <li>
              invoke() blocked:{" "}
              <span className={!testResult.hasInvoke ? "text-green-500" : "text-red-500"}>
                {!testResult.hasInvoke ? "Yes ✓" : "No ✗"}
              </span>
            </li>
            <li>
              Parent document blocked:{" "}
              <span className={!testResult.canAccessParentDocument ? "text-green-500" : "text-red-500"}>
                {!testResult.canAccessParentDocument ? "Yes ✓" : "No ✗"}
              </span>
            </li>
            <li>
              Parent localStorage blocked:{" "}
              <span className={!testResult.canAccessParentLocalStorage ? "text-green-500" : "text-red-500"}>
                {!testResult.canAccessParentLocalStorage ? "Yes ✓" : "No ✗"}
              </span>
            </li>
            <li>
              Iframe origin: <code className="text-xs">{testResult.windowOrigin}</code>
            </li>
          </ul>
        </div>
      )}

      {/* Communication Test Controls */}
      <div className="p-3 rounded bg-muted space-y-3">
        <h3 className="font-medium">Bidirectional Communication Test:</h3>
        <div className="flex items-center gap-2 text-sm">
          <span>
            Iframe ready:{" "}
            <span className={commState.iframeReady ? "text-green-500" : "text-yellow-500"}>
              {commState.iframeReady ? "Yes ✓" : "Waiting..."}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handlePing}
            disabled={!commState.iframeReady}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded"
          >
            Send Ping
          </button>
          <button
            onClick={handleEval}
            disabled={!commState.iframeReady}
            className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded"
          >
            Test Eval (1+2+3)
          </button>
          <button
            onClick={handleRender}
            disabled={!commState.iframeReady}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded"
          >
            Test Render HTML
          </button>
        </div>
        <div className="text-sm space-y-1">
          <p>Pong responses received: {commState.pingCount}</p>
          {commState.evalResult && <p>Eval result: {commState.evalResult}</p>}
          {commState.renderComplete && (
            <p className="text-green-500">✓ Render completed successfully</p>
          )}
        </div>
      </div>

      {/* The actual isolated iframe */}
      {blobUrl && (
        <div className="border rounded overflow-hidden">
          <iframe
            ref={iframeRef}
            src={blobUrl}
            sandbox="allow-scripts"
            className="w-full h-80 bg-neutral-900"
            title="Isolation Test Frame"
          />
        </div>
      )}

      {/* Sandbox attribute explanation */}
      <div className="text-xs text-muted-foreground">
        <p>
          <strong>Sandbox attributes:</strong> allow-scripts (no allow-same-origin)
        </p>
        <p>
          This prevents the iframe from accessing the parent's origin, which should
          block Tauri's IPC injection since Tauri only injects into content at the app's origin.
        </p>
      </div>

      {/* Production IsolatedFrame Demo */}
      <ProductionFrameDemo />
    </div>
  );
}

/**
 * Demo of the production IsolatedFrame component.
 */
function ProductionFrameDemo() {
  const frameRef = useRef<IsolatedFrameHandle>(null);
  const [isReady, setIsReady] = useState(false);
  const [height, setHeight] = useState(0);

  const handleRenderHtml = () => {
    frameRef.current?.render({
      mimeType: "text/html",
      data: `
        <h2 style="margin: 0 0 8px 0;">Production IsolatedFrame Test</h2>
        <p>This content was rendered via the <code>IsolatedFrame</code> component.</p>
        <table>
          <tr><th>Feature</th><th>Status</th></tr>
          <tr><td>Blob URL isolation</td><td style="color: #4ade80;">✓</td></tr>
          <tr><td>postMessage communication</td><td style="color: #4ade80;">✓</td></tr>
          <tr><td>Auto-resizing</td><td style="color: #4ade80;">✓</td></tr>
        </table>
        <script>console.log('Script executed in isolated frame!');</script>
      `,
    });
  };

  const handleRenderImage = () => {
    // A small test image (1x1 red pixel in base64)
    frameRef.current?.render({
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    });
  };

  const handleClear = () => {
    frameRef.current?.clear();
  };

  return (
    <div className="p-3 rounded bg-muted space-y-3 border-t border-border mt-4">
      <h3 className="font-medium">Production IsolatedFrame Component:</h3>
      <div className="flex items-center gap-2 text-sm">
        <span>
          Ready:{" "}
          <span className={isReady ? "text-green-500" : "text-yellow-500"}>
            {isReady ? "Yes ✓" : "Waiting..."}
          </span>
        </span>
        <span className="text-muted-foreground">|</span>
        <span>Height: {height}px</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleRenderHtml}
          disabled={!isReady}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded"
        >
          Render HTML
        </button>
        <button
          onClick={handleRenderImage}
          disabled={!isReady}
          className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded"
        >
          Render Image
        </button>
        <button
          onClick={handleClear}
          disabled={!isReady}
          className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded"
        >
          Clear
        </button>
      </div>
      <div className="border rounded overflow-hidden">
        <IsolatedFrame
          ref={frameRef}
          darkMode={true}
          minHeight={48}
          maxHeight={400}
          onReady={() => setIsReady(true)}
          onResize={setHeight}
          onLinkClick={(url, newTab) => {
            console.log("Link clicked:", url, newTab);
            window.open(url, newTab ? "_blank" : "_self");
          }}
          onError={(err) => console.error("Frame error:", err)}
        />
      </div>
    </div>
  );
}
