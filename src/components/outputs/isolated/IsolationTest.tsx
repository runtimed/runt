"use client";

import { useEffect, useRef, useState } from "react";

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
    pre { font-size: 12px; overflow: auto; }
  </style>
</head>
<body>
  <h3>Iframe Isolation Test</h3>
  <div id="results"></div>
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
export function IsolationTest() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<IsolationTestResult | null>(null);
  const [parentHasTauri, setParentHasTauri] = useState<boolean>(false);

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
      if (event.data?.type === "isolation_test_result") {
        setTestResult(event.data.results);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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

      {/* The actual isolated iframe */}
      {blobUrl && (
        <div className="border rounded overflow-hidden">
          <iframe
            ref={iframeRef}
            src={blobUrl}
            sandbox="allow-scripts"
            className="w-full h-64 bg-neutral-900"
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
    </div>
  );
}
