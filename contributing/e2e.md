# E2E Testing Guide

This guide covers writing and running end-to-end tests for the notebook application.

## Overview

E2E tests verify the full application works correctly from a user's perspective. We use:

- **WebdriverIO** - Browser automation framework
- **Mocha** - Test runner
- **W3C WebDriver protocol** - Drives the Tauri app

Two modes are available:

1. **Native mode (macOS)** — The app includes a built-in WebDriver server. No Docker needed.
2. **Docker mode** — Runs inside a Linux container with `tauri-driver`. Used in CI.

## Running Tests

### Native Mode (macOS — Recommended for Development)

The app has a built-in WebDriver server activated by the `webdriver-test` feature flag.
This lets you run E2E tests natively on macOS without Docker.

```bash
# 1. Build with WebDriver support (builds frontend + Rust binary)
cargo xtask build-e2e

# 2. Start the app with the WebDriver server
./target/debug/notebook --webdriver-port 4444

# 3. In another terminal, run tests
pnpm test:e2e:native

# Or run a single spec
E2E_SPEC=e2e/specs/notebook-execution.spec.js pnpm test:e2e:native
```

**Important:** You must use `cargo xtask build-e2e` (not plain `cargo build`) because
`cargo tauri build` embeds the frontend assets into the binary. A plain `cargo build`
would try to connect to a Vite dev server instead.

### Docker Mode (CI / Linux)

For CI pipelines or when you need a reproducible Linux environment:

```bash
pnpm test:e2e:docker
```

The Dockerfile uses [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) for
Rust dependency caching and overrides the release profile for faster compilation
(no LTO, more codegen units). Source-only changes skip the expensive dependency build.

### Interactive Debugging (Docker)

```bash
docker compose --profile dev run --rm tauri-e2e-shell
```

Inside the container:
```bash
# Run all tests
pnpm test:e2e

# Run a single spec
pnpm wdio run e2e/wdio.conf.js --spec e2e/specs/notebook-execution.spec.js
```

## Architecture

### Native Mode

```
┌──────────────┐    W3C WebDriver    ┌──────────────────────────┐
│  WebdriverIO │    HTTP protocol    │   notebook binary        │
│  Test Runner │ ◄─────────────────► │                          │
│              │    localhost:4444    │  ┌────────────────────┐  │
│  (test specs)│                     │  │ WebDriver Server   │  │
│              │                     │  │ (axum HTTP server)  │  │
│              │                     │  └────────┬───────────┘  │
└──────────────┘                     │           │              │
                                     │   eval()  │  fetch()     │
                                     │           ▼              │
                                     │  ┌────────────────────┐  │
                                     │  │ WebView            │  │
                                     │  │  ┌──────────────┐  │  │
                                     │  │  │ Test Bridge   │  │  │
                                     │  │  │ (injected JS) │  │  │
                                     │  │  └──────────────┘  │  │
                                     │  └────────────────────┘  │
                                     └──────────────────────────┘
```

The built-in WebDriver server:
1. Receives W3C WebDriver HTTP requests from WebdriverIO
2. Translates them to JavaScript and executes via `webview.eval()`
3. The JS bridge executes DOM operations and sends results back via `fetch()`
4. Results are returned as WebDriver HTTP responses

### Docker Mode

Same WebdriverIO tests, but the app runs inside a Docker container with
`tauri-driver` + `webkit2gtk-driver` providing the WebDriver protocol bridge.

## Writing Tests

### File Location

Tests live in `e2e/specs/` with the `.spec.js` extension:

```
e2e/
├── specs/
│   ├── iframe-isolation.spec.js    # Security tests
│   └── notebook-execution.spec.js  # Happy path tests
├── wdio.conf.js                    # WebdriverIO config
└── Dockerfile                      # Docker build
```

### Basic Structure

```javascript
import { browser, expect } from "@wdio/globals";

describe("Feature Name", () => {
  before(async () => {
    // Setup before all tests in this describe block
    await browser.pause(5000); // Wait for app to load
  });

  it("should do something specific", async () => {
    // Arrange: Set up test state
    const element = await $('[data-testid="my-element"]');

    // Act: Perform actions
    await element.click();

    // Assert: Verify results
    expect(await element.getText()).toContain("expected text");
  });
});
```

### Common Patterns

#### Finding Elements

Use data attributes for reliable selection:

```javascript
// By test ID (preferred)
const button = await $('[data-testid="execute-button"]');

// By data attributes
const codeCell = await $('[data-cell-type="code"]');
const output = await $('[data-slot="ansi-stream-output"]');

// By CSS class (less stable)
const editor = await $('.cm-content[contenteditable="true"]');

// Within a parent element
const cellOutput = await codeCell.$('[data-slot="ansi-stream-output"]');
```

#### Typing Text

```javascript
// Click to focus, then type
await editor.click();
await browser.keys("print('hello world')");

// For reliable typing (avoids dropped characters)
async function typeSlowly(text, delay = 50) {
  for (const char of text) {
    await browser.keys(char);
    await browser.pause(delay);
  }
}
await typeSlowly("print('hello')");

// Keyboard shortcuts
await browser.keys(["Shift", "Enter"]); // Execute cell
await browser.keys(["Control", "a"]);   // Select all
```

#### Waiting for Async Operations

```javascript
// Wait for element to exist
await element.waitForExist({ timeout: 5000 });

// Wait for element to be clickable
await button.waitForClickable({ timeout: 5000 });

// Wait for custom condition
await browser.waitUntil(
  async () => {
    const output = await $('[data-slot="ansi-stream-output"]');
    if (!(await output.isExisting())) return false;
    const text = await output.getText();
    return text.includes("expected output");
  },
  {
    timeout: 30000,
    timeoutMsg: "Output did not appear",
    interval: 500,
  }
);
```

#### Working with Iframes

For testing isolated content in iframes:

```javascript
// Switch to iframe
const iframe = await $('iframe[sandbox]');
await browser.switchToFrame(iframe);

// Run assertions inside iframe
const result = await browser.execute(() => {
  return window.someValue;
});

// Switch back to main frame
await browser.switchToParentFrame();
```

### Available Selectors

| Selector | Element |
|----------|---------|
| `[data-cell-type="code"]` | Code cell container |
| `[data-cell-type="markdown"]` | Markdown cell container |
| `[data-cell-id="..."]` | Cell by specific ID |
| `[data-testid="execute-button"]` | Run cell button |
| `[data-slot="output-area"]` | Cell output area |
| `[data-slot="ansi-stream-output"]` | Stream output (stdout/stderr) |
| `[data-slot="ansi-error-output"]` | Error output with traceback |
| `.cm-content[contenteditable="true"]` | CodeMirror editor |
| `iframe[sandbox]` | Isolated output iframe |

### Timeout Guidelines

| Operation | Timeout |
|-----------|---------|
| App load | 5 seconds |
| Kernel startup (first run) | 30-60 seconds |
| Cell execution (kernel ready) | 15 seconds |
| Element appear | 5 seconds |
| Button clickable | 5 seconds |

### Adding data-testid Attributes

When adding new features, include `data-testid` attributes for testing:

```tsx
// In your React component
<button
  onClick={handleClick}
  data-testid="my-feature-button"
>
  Click me
</button>
```

Naming conventions:
- Use kebab-case: `data-testid="execute-button"`
- Be specific: `data-testid="cell-delete-button"` not `data-testid="delete"`
- Match component names when sensible

## Debugging Tips

### Console Output

Tests log progress to the console:

```javascript
console.log("Step completed:", someValue);
```

### Page State

Inspect the page during test development:

```javascript
// Get page source
const html = await browser.getPageSource();
console.log(html);

// Get page title/URL
console.log("Title:", await browser.getTitle());
console.log("URL:", await browser.getUrl());

// Execute JS in the page
const result = await browser.execute(() => {
  return document.querySelector('[data-cell-type]')?.outerHTML;
});
```

### Pausing Tests

Add pauses to observe behavior:

```javascript
await browser.pause(5000); // Pause for 5 seconds
```

## Test Configuration

Configuration is in `e2e/wdio.conf.js`:

- **maxInstances**: 1 (single Tauri app instance)
- **timeout**: 180000ms per test (3 minutes, for kernel startup scenarios)
- **waitforTimeout**: 10000ms for waitFor* methods
- **connectionRetryTimeout**: 120000ms for WebDriver connection

## CI Integration

Tests run in CI via Docker. The Docker build uses cargo-chef for dependency caching
and overrides the release profile for faster compilation.

## Troubleshooting

### "No such element" Errors

- Element may not be rendered yet - add `waitForExist()`
- Selector may be wrong - verify with `browser.getPageSource()`
- Element may be in an iframe - use `switchToFrame()`

### Timeout Errors

- Kernel startup is slow on first run - increase timeout to 60s
- Check if the app loaded correctly
- Verify the expected element is actually rendered

### Flaky Tests

- Add explicit waits instead of `pause()`
- Use `waitUntil()` for async conditions
- Type slowly to avoid dropped keystrokes
- Check for race conditions in the app

### Docker Build Issues

```bash
# Force rebuild without cache
docker compose build --no-cache tauri-e2e

# Inspect container for debugging
docker compose --profile dev run --rm tauri-e2e-shell
```
