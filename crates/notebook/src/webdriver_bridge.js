// WebDriver Test Bridge
// Injected into the Tauri WebView when --webdriver-port is set.
// Handles DOM queries, clicks, keyboard input, and screenshots
// by communicating with the Rust WebDriver server via Tauri IPC.

(function () {
  "use strict";

  // Element reference store: WebDriver element ID -> DOM Element
  const elementStore = new Map();
  let nextElementId = 1;

  // Track the current browsing context (for iframe switching)
  let currentDocument = document;
  let currentWindow = window;

  /**
   * Store a DOM element and return its WebDriver element ID
   */
  function storeElement(element) {
    if (!element) return null;

    // Check if we already have this element stored
    for (const [id, el] of elementStore) {
      if (el === element) return id;
    }

    const id = "element-" + nextElementId++;
    elementStore.set(id, element);
    return id;
  }

  /**
   * Retrieve a stored DOM element by its WebDriver ID
   */
  function getElement(id) {
    const el = elementStore.get(id);
    if (!el || !el.isConnected) {
      elementStore.delete(id);
      return null;
    }
    return el;
  }

  /**
   * Find element using CSS selector, optionally scoped to a parent
   */
  function findElement(selector, parentId) {
    const context = parentId ? getElement(parentId) : currentDocument;
    if (!context) return { error: "stale element reference" };

    // WebDriver "using" strategies
    const element = context.querySelector(selector);
    if (!element) return { error: "no such element" };

    return { elementId: storeElement(element) };
  }

  /**
   * Find all elements matching a CSS selector
   */
  function findElements(selector, parentId) {
    const context = parentId ? getElement(parentId) : currentDocument;
    if (!context) return { error: "stale element reference" };

    const elements = context.querySelectorAll(selector);
    return {
      elementIds: Array.from(elements).map((el) => storeElement(el)),
    };
  }

  /**
   * Find element using various WebDriver strategies
   */
  function findElementByStrategy(using, value, parentId) {
    let selector;
    switch (using) {
      case "css selector":
        selector = value;
        break;
      case "tag name":
        selector = value;
        break;
      case "link text":
        // Find <a> elements by exact text
        const context1 = parentId
          ? getElement(parentId)
          : currentDocument;
        if (!context1) return { error: "stale element reference" };
        const links = context1.querySelectorAll("a");
        for (const link of links) {
          if (link.textContent.trim() === value) {
            return { elementId: storeElement(link) };
          }
        }
        return { error: "no such element" };
      case "partial link text":
        const context2 = parentId
          ? getElement(parentId)
          : currentDocument;
        if (!context2) return { error: "stale element reference" };
        const allLinks = context2.querySelectorAll("a");
        for (const link of allLinks) {
          if (link.textContent.includes(value)) {
            return { elementId: storeElement(link) };
          }
        }
        return { error: "no such element" };
      case "xpath":
        const context3 = parentId
          ? getElement(parentId)
          : currentDocument;
        if (!context3) return { error: "stale element reference" };
        const xpathResult = document.evaluate(
          value,
          context3,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        if (xpathResult.singleNodeValue) {
          return {
            elementId: storeElement(xpathResult.singleNodeValue),
          };
        }
        return { error: "no such element" };
      default:
        selector = value;
    }

    return findElement(selector, parentId);
  }

  /**
   * Click an element
   */
  function clickElement(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };

    // Scroll into view
    el.scrollIntoView({ block: "center", inline: "center" });

    // Dispatch mouse events in the correct order
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const eventOpts = {
      bubbles: true,
      cancelable: true,
      view: currentWindow,
      clientX: x,
      clientY: y,
    };

    el.dispatchEvent(new MouseEvent("mouseover", eventOpts));
    el.dispatchEvent(new MouseEvent("mousedown", eventOpts));
    el.focus();
    el.dispatchEvent(new MouseEvent("mouseup", eventOpts));
    el.dispatchEvent(new MouseEvent("click", eventOpts));

    return { success: true };
  }

  /**
   * Get text content of an element
   */
  function getElementText(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };
    return { text: el.textContent || "" };
  }

  /**
   * Get an attribute of an element
   */
  function getElementAttribute(elementId, name) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };
    const value = el.getAttribute(name);
    return { value: value };
  }

  /**
   * Check if element is displayed
   */
  function isElementDisplayed(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };

    const style = currentWindow.getComputedStyle(el);
    const displayed =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0;
    return { displayed };
  }

  /**
   * Check if element is enabled
   */
  function isElementEnabled(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };
    return { enabled: !el.disabled };
  }

  /**
   * Get element tag name
   */
  function getElementTagName(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };
    return { tagName: el.tagName.toLowerCase() };
  }

  /**
   * Get element rect (position and size)
   */
  function getElementRect(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  /**
   * Get element CSS property
   */
  function getElementCssValue(elementId, propertyName) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };
    const value = currentWindow.getComputedStyle(el).getPropertyValue(propertyName);
    return { value };
  }

  /**
   * Clear an input/textarea element
   */
  function clearElement(elementId) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { success: true };
  }

  /**
   * Send keys to an element (type text or press keys)
   */
  function sendKeysToElement(elementId, text) {
    const el = getElement(elementId);
    if (!el) return { error: "stale element reference" };

    el.focus();

    for (const char of text) {
      const key = SPECIAL_KEYS[char] || char;

      el.dispatchEvent(new KeyboardEvent("keydown", {
        key: key, code: getKeyCode(key), bubbles: true, cancelable: true,
      }));

      if (key.length === 1 && !MODIFIER_KEYS.has(key)) {
        // Use execCommand for contenteditable elements (CodeMirror)
        if (el.isContentEditable || el.closest("[contenteditable]")) {
          currentDocument.execCommand("insertText", false, key);
        } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          el.value += key;
          el.dispatchEvent(new InputEvent("input", {
            data: key, inputType: "insertText", bubbles: true, cancelable: true,
          }));
        }
      }

      el.dispatchEvent(new KeyboardEvent("keyup", {
        key: key, code: getKeyCode(key), bubbles: true, cancelable: true,
      }));
    }

    return { success: true };
  }

  /**
   * Send keys to the active element (legacy browser.keys() support).
   * Uses execCommand("insertText") for printable chars (works with CodeMirror 6)
   * and KeyboardEvent dispatch for special keys/shortcuts.
   */
  function sendKeys(text) {
    const target = currentDocument.activeElement || currentDocument.body;
    const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
    const heldModifiers = [];

    for (const char of text) {
      const key = SPECIAL_KEYS[char] || char;

      // Null key (\uE000) releases all modifiers
      if (char === "\uE000") {
        for (const mod of heldModifiers) {
          const upOpts = {
            key: mod, code: getKeyCode(mod),
            bubbles: true, cancelable: true,
            shiftKey: modifiers.shift, ctrlKey: modifiers.ctrl,
            altKey: modifiers.alt, metaKey: modifiers.meta,
          };
          target.dispatchEvent(new KeyboardEvent("keyup", upOpts));
          if (mod === "Shift") modifiers.shift = false;
          else if (mod === "Control") modifiers.ctrl = false;
          else if (mod === "Alt") modifiers.alt = false;
          else if (mod === "Meta") modifiers.meta = false;
        }
        heldModifiers.length = 0;
        continue;
      }

      // Track modifier state
      if (key === "Shift") { modifiers.shift = true; heldModifiers.push(key); }
      else if (key === "Control") { modifiers.ctrl = true; heldModifiers.push(key); }
      else if (key === "Alt") { modifiers.alt = true; heldModifiers.push(key); }
      else if (key === "Meta") { modifiers.meta = true; heldModifiers.push(key); }

      const eventOpts = {
        key: key, code: getKeyCode(key),
        bubbles: true, cancelable: true,
        shiftKey: modifiers.shift, ctrlKey: modifiers.ctrl,
        altKey: modifiers.alt, metaKey: modifiers.meta,
      };

      // Always dispatch keydown (CM6 uses this for keyboard shortcuts)
      target.dispatchEvent(new KeyboardEvent("keydown", eventOpts));

      // For printable, non-modifier, non-special characters without modifiers held:
      // use execCommand("insertText") so CodeMirror 6 processes it correctly
      const hasModifier = modifiers.ctrl || modifiers.alt || modifiers.meta;
      if (!MODIFIER_KEYS.has(key) && key.length === 1 && !hasModifier) {
        currentDocument.execCommand("insertText", false, key);
      }

      // Non-modifier keys get immediate keyup
      if (!MODIFIER_KEYS.has(key)) {
        target.dispatchEvent(new KeyboardEvent("keyup", eventOpts));
      }
    }

    // Release any held modifiers at end
    for (const mod of heldModifiers) {
      if (mod === "Shift") modifiers.shift = false;
      else if (mod === "Control") modifiers.ctrl = false;
      else if (mod === "Alt") modifiers.alt = false;
      else if (mod === "Meta") modifiers.meta = false;
      const upOpts = {
        key: mod, code: getKeyCode(mod),
        bubbles: true, cancelable: true,
        shiftKey: modifiers.shift, ctrlKey: modifiers.ctrl,
        altKey: modifiers.alt, metaKey: modifiers.meta,
      };
      target.dispatchEvent(new KeyboardEvent("keyup", upOpts));
    }

    return { success: true };
  }

  // Key name mapping for WebDriver special keys
  const SPECIAL_KEYS = {
    "\uE000": "Unidentified", // Null (release modifier)
    "\uE001": "Cancel",
    "\uE002": "Help",
    "\uE003": "Backspace",
    "\uE004": "Tab",
    "\uE005": "Clear",
    "\uE006": "Return",
    "\uE007": "Enter",
    "\uE008": "Shift",
    "\uE009": "Control",
    "\uE00A": "Alt",
    "\uE00B": "Pause",
    "\uE00C": "Escape",
    "\uE00D": " ",
    "\uE00E": "PageUp",
    "\uE00F": "PageDown",
    "\uE010": "End",
    "\uE011": "Home",
    "\uE012": "ArrowLeft",
    "\uE013": "ArrowUp",
    "\uE014": "ArrowRight",
    "\uE015": "ArrowDown",
    "\uE016": "Insert",
    "\uE017": "Delete",
    "\uE018": ";",
    "\uE019": "=",
    "\uE01A": "0",
    "\uE01B": "1",
    "\uE01C": "2",
    "\uE01D": "3",
    "\uE01E": "4",
    "\uE01F": "5",
    "\uE020": "6",
    "\uE021": "7",
    "\uE022": "8",
    "\uE023": "9",
    "\uE024": "*",
    "\uE025": "+",
    "\uE026": ",",
    "\uE027": "-",
    "\uE028": ".",
    "\uE029": "/",
    "\uE031": "F1",
    "\uE032": "F2",
    "\uE033": "F3",
    "\uE034": "F4",
    "\uE035": "F5",
    "\uE036": "F6",
    "\uE037": "F7",
    "\uE038": "F8",
    "\uE039": "F9",
    "\uE03A": "F10",
    "\uE03B": "F11",
    "\uE03C": "F12",
    "\uE03D": "Meta",
    "\uE040": "ZenkakuHankaku",
    "\uE050": "Shift",      // Right shift
    "\uE051": "Control",    // Right control
    "\uE052": "Alt",        // Right alt
    "\uE053": "Meta",       // Right meta
  };

  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

  /**
   * Process W3C WebDriver Actions (keyboard and pointer)
   */
  function performActions(actions) {
    // Track modifier key state
    const modifiers = { shift: false, ctrl: false, alt: false, meta: false };

    for (const actionSequence of actions) {
      if (actionSequence.type === "key") {
        for (const action of actionSequence.actions) {
          if (action.type === "keyDown") {
            const key = SPECIAL_KEYS[action.value] || action.value;

            // Track modifier state
            if (key === "Shift") modifiers.shift = true;
            else if (key === "Control") modifiers.ctrl = true;
            else if (key === "Alt") modifiers.alt = true;
            else if (key === "Meta") modifiers.meta = true;

            const target =
              currentDocument.activeElement || currentDocument.body;
            const eventOpts = {
              key: key,
              code: getKeyCode(key),
              bubbles: true,
              cancelable: true,
              shiftKey: modifiers.shift,
              ctrlKey: modifiers.ctrl,
              altKey: modifiers.alt,
              metaKey: modifiers.meta,
            };

            target.dispatchEvent(new KeyboardEvent("keydown", eventOpts));

            // For printable characters, also fire input event
            if (!MODIFIER_KEYS.has(key) && key.length === 1) {
              target.dispatchEvent(new KeyboardEvent("keypress", eventOpts));

              const inputEvent = new InputEvent("input", {
                data: key,
                inputType: "insertText",
                bubbles: true,
                cancelable: true,
              });
              target.dispatchEvent(inputEvent);
            }
          } else if (action.type === "keyUp") {
            const key = SPECIAL_KEYS[action.value] || action.value;

            // Track modifier state
            if (key === "Shift") modifiers.shift = false;
            else if (key === "Control") modifiers.ctrl = false;
            else if (key === "Alt") modifiers.alt = false;
            else if (key === "Meta") modifiers.meta = false;

            const target =
              currentDocument.activeElement || currentDocument.body;
            const eventOpts = {
              key: key,
              code: getKeyCode(key),
              bubbles: true,
              cancelable: true,
              shiftKey: modifiers.shift,
              ctrlKey: modifiers.ctrl,
              altKey: modifiers.alt,
              metaKey: modifiers.meta,
            };

            target.dispatchEvent(new KeyboardEvent("keyup", eventOpts));
          } else if (action.type === "pause") {
            // Pauses are handled on the Rust side
          }
        }
      } else if (actionSequence.type === "pointer") {
        for (const action of actionSequence.actions) {
          if (action.type === "pointerDown" || action.type === "pointerUp") {
            // pointer actions at current position
          } else if (action.type === "pointerMove") {
            // Move to element or coordinates
          } else if (action.type === "pause") {
            // Handled on Rust side
          }
        }
      } else if (actionSequence.type === "none") {
        // "none" action source — only pauses
      }
    }

    return { success: true };
  }

  /**
   * Map key names to key codes
   */
  function getKeyCode(key) {
    const codes = {
      Enter: "Enter",
      Return: "Enter",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
      Escape: "Escape",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Shift: "ShiftLeft",
      Control: "ControlLeft",
      Alt: "AltLeft",
      Meta: "MetaLeft",
      " ": "Space",
    };

    if (codes[key]) return codes[key];
    if (key.length === 1) {
      const code = key.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) return "Key" + key.toUpperCase();
      if (code >= 48 && code <= 57) return "Digit" + key;
    }
    return key;
  }

  /**
   * Switch to an iframe by index, element ID, or back to top
   */
  function switchToFrame(frameId) {
    if (frameId === null) {
      // Switch to top-level browsing context
      currentDocument = document;
      currentWindow = window;
      return { success: true };
    }

    if (typeof frameId === "number") {
      // Switch by index
      const iframes = currentDocument.querySelectorAll("iframe");
      if (frameId >= iframes.length) return { error: "no such frame" };
      try {
        currentDocument = iframes[frameId].contentDocument;
        currentWindow = iframes[frameId].contentWindow;
        return { success: true };
      } catch (e) {
        return { error: "no such frame: " + e.message };
      }
    }

    if (typeof frameId === "object" && frameId["element-6066-11e4-a52e-4f735466cecf"]) {
      // Switch by element reference
      const elId = frameId["element-6066-11e4-a52e-4f735466cecf"];
      const el = getElement(elId);
      if (!el || el.tagName !== "IFRAME") return { error: "no such frame" };
      try {
        currentDocument = el.contentDocument;
        currentWindow = el.contentWindow;
        return { success: true };
      } catch (e) {
        return { error: "no such frame: " + e.message };
      }
    }

    return { error: "invalid frame id" };
  }

  /**
   * Switch to parent frame
   */
  function switchToParentFrame() {
    if (currentWindow === window) return { success: true };
    try {
      currentWindow = currentWindow.parent;
      currentDocument = currentWindow.document;
      return { success: true };
    } catch (e) {
      currentWindow = window;
      currentDocument = document;
      return { success: true };
    }
  }

  /**
   * Take a screenshot using canvas
   */
  async function takeScreenshot() {
    // Try using html2canvas if available, otherwise capture what we can
    try {
      const canvas = document.createElement("canvas");
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;

      // Use a basic approach: serialize current page state
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);

      // Draw the document body
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml">
              ${document.documentElement.outerHTML}
            </div>
          </foreignObject>
        </svg>`;

      const img = new Image();
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      return new Promise((resolve) => {
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve({ screenshot: canvas.toDataURL("image/png").split(",")[1] });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          // Return a minimal 1x1 pixel PNG as fallback
          resolve({
            screenshot:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          });
        };
        img.src = url;
      });
    } catch (e) {
      return {
        screenshot:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      };
    }
  }

  /**
   * Execute a script in the page context
   */
  function executeScript(script, args) {
    try {
      // Convert element references in args to actual DOM elements
      const resolvedArgs = (args || []).map((arg) => {
        if (arg && typeof arg === "object" && arg["element-6066-11e4-a52e-4f735466cecf"]) {
          return getElement(arg["element-6066-11e4-a52e-4f735466cecf"]);
        }
        return arg;
      });

      const fn = new Function(...resolvedArgs.map((_, i) => `arg${i}`), script);
      const result = fn(...resolvedArgs);

      // If result is a DOM element, store it and return a reference
      if (result instanceof Element) {
        return {
          value: {
            "element-6066-11e4-a52e-4f735466cecf": storeElement(result),
          },
        };
      }

      return { value: result === undefined ? null : result };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ============================================================
  // Command dispatcher — called from Rust via webview.eval()
  // ============================================================

  window.__TEST_BRIDGE = {
    /**
     * Process a command from the WebDriver server
     * Returns the result synchronously (or a promise for async ops)
     */
    exec(requestId, command, params) {
      let result;

      try {
        switch (command) {
          case "findElement":
            result = findElementByStrategy(
              params.using,
              params.value,
              params.parentId
            );
            break;
          case "findElements":
            result = findElements(params.value, params.parentId);
            break;
          case "clickElement":
            result = clickElement(params.elementId);
            break;
          case "getElementText":
            result = getElementText(params.elementId);
            break;
          case "getElementAttribute":
            result = getElementAttribute(params.elementId, params.name);
            break;
          case "isElementDisplayed":
            result = isElementDisplayed(params.elementId);
            break;
          case "isElementEnabled":
            result = isElementEnabled(params.elementId);
            break;
          case "getElementTagName":
            result = getElementTagName(params.elementId);
            break;
          case "getElementRect":
            result = getElementRect(params.elementId);
            break;
          case "getElementCssValue":
            result = getElementCssValue(params.elementId, params.propertyName);
            break;
          case "clearElement":
            result = clearElement(params.elementId);
            break;
          case "sendKeysToElement":
            result = sendKeysToElement(params.elementId, params.text);
            break;
          case "sendKeys":
            result = sendKeys(params.text);
            break;
          case "performActions":
            result = performActions(params.actions);
            break;
          case "switchToFrame":
            result = switchToFrame(params.frameId);
            break;
          case "switchToParentFrame":
            result = switchToParentFrame();
            break;
          case "getTitle":
            result = { value: document.title };
            break;
          case "getUrl":
            result = { value: location.href };
            break;
          case "getPageSource":
            result = { value: document.documentElement.outerHTML };
            break;
          case "executeScript":
            result = executeScript(params.script, params.args);
            break;
          case "screenshot":
            // Async operation
            takeScreenshot().then((r) => {
              sendResult(requestId, r);
            });
            return; // Don't send result synchronously
          default:
            result = { error: "unknown command: " + command };
        }
      } catch (e) {
        result = { error: e.message || String(e) };
      }

      sendResult(requestId, result);
    },
  };

  /**
   * Send a result back to the WebDriver server via HTTP POST.
   * The bridge port is embedded by the Rust server when injecting this script.
   */
  function sendResult(requestId, result) {
    const port = window.__TEST_BRIDGE_PORT || 4444;
    fetch(`http://127.0.0.1:${port}/__bridge_result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, result: JSON.stringify(result) }),
    }).catch((e) => {
      console.error("[webdriver-bridge] Failed to send result:", e);
    });
  }

  console.log("[webdriver-bridge] Test bridge initialized");
})();
