# E2E Testing Guide

This guide covers writing and running end-to-end tests for the notebook application.

## Overview

E2E tests verify the full application works correctly from a user's perspective. We use:

- **WebdriverIO** - Browser automation framework
- **Mocha** - Test runner
- **Tauri WebDriver** - Drives the Tauri app via WebDriver protocol
- **Docker** - Required because Tauri WebDriver has macOS sandboxing issues

## Running Tests

### CI Mode (Full Build)

For CI pipelines or when you need a clean, reproducible build:

```bash
pnpm test:e2e:docker
```

This builds everything from scratch (~4-5 minutes).

### Dev Mode (Fast Iteration)

For rapid iteration during development:

```bash
# First time only: Build base image with cached dependencies
pnpm e2e:base:build

# Then run tests quickly (~1-2 minutes)
pnpm test:e2e:dev
```

### Interactive Debugging

For debugging failing tests:

```bash
pnpm e2e:dev:shell
```

Inside the container:
```bash
# Run all tests
pnpm test:e2e

# Run a single spec
pnpm wdio run e2e/wdio.conf.js --spec e2e/specs/notebook-execution.spec.js
```

## Writing Tests

### File Location

Tests live in `e2e/specs/` with the `.spec.js` extension:

```
e2e/
├── specs/
│   ├── iframe-isolation.spec.js    # Security tests
│   └── notebook-execution.spec.js  # Happy path tests
├── wdio.conf.js                    # WebdriverIO config
└── Dockerfile                      # CI build
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

### Screenshots (not currently available)

Note: Screenshot functionality requires additional setup in the Docker environment.

## Test Configuration

Configuration is in `e2e/wdio.conf.js`:

- **maxInstances**: 1 (single Tauri app instance)
- **timeout**: 60000ms per test
- **waitforTimeout**: 10000ms for waitFor* methods
- **connectionRetryTimeout**: 120000ms for WebDriver connection

## CI Integration

Tests run automatically in CI via `pnpm test:e2e:docker`. The Docker build ensures:

- Consistent Linux environment
- All dependencies installed
- Xvfb for headless display
- WebDriver properly configured

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

# Rebuild dev image after code changes
pnpm e2e:dev:build
```
