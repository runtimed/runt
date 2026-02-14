# E2E Testing

End-to-end tests for the notebook application using WebdriverIO and Tauri's WebDriver.

## Why Docker?

Tauri's WebDriver on macOS is blocked by sandboxing restrictions. We run tests in a Linux Docker container with Xvfb for headless display rendering.

## Quick Start

### CI Mode (Full Build)

For CI pipelines or first-time setup. Builds everything from scratch:

```bash
pnpm test:e2e:docker
```

This takes 4-5 minutes due to Rust compilation.

### Dev Mode (Fast Iteration)

For rapid iteration during development. Uses cached dependencies:

```bash
# First time only: Build base image with cached deps (takes ~5 min)
pnpm e2e:base:build

# Then iterate quickly (takes ~1-2 min)
pnpm test:e2e:dev
```

The base image caches:
- System dependencies (xvfb, webkit2gtk-driver)
- tauri-cli installation
- Rust dependency downloads

### Interactive Debugging

Drop into a shell with the test environment ready:

```bash
pnpm e2e:dev:shell
```

Inside the container:
```bash
# Run all tests
pnpm test:e2e

# Run a single spec file
pnpm wdio run e2e/wdio.conf.js --spec e2e/specs/notebook-execution.spec.js
```

## Test Files

| File | Description |
|------|-------------|
| `specs/iframe-isolation.spec.js` | Security tests for iframe sandbox isolation |
| `specs/notebook-execution.spec.js` | Happy path: create, edit, run cell, see output |

## Dockerfile Variants

| File | Purpose |
|------|---------|
| `Dockerfile` | CI mode - full isolated build |
| `Dockerfile.base` | Base image with cached dependencies |
| `Dockerfile.dev` | Dev mode - builds on base image |

## npm Scripts

| Script | Description |
|--------|-------------|
| `test:e2e:docker` | Run tests in CI mode (full build) |
| `test:e2e:dev` | Run tests in dev mode (fast, needs base image) |
| `e2e:base:build` | Build the base image (run once) |
| `e2e:dev:build` | Rebuild dev image after code changes |
| `e2e:dev:shell` | Interactive shell for debugging |

## Writing Tests

Tests use WebdriverIO with Mocha. Key patterns:

```javascript
import { browser, expect } from "@wdio/globals";

describe("My Feature", () => {
  it("should do something", async () => {
    // Find elements using CSS selectors
    const cell = await $('[data-cell-type="code"]');

    // Interact with elements
    await cell.click();
    await browser.keys("print('hello')");

    // Wait for async operations
    await browser.waitUntil(async () => {
      const output = await $('[data-slot="ansi-stream-output"]');
      return output.isExisting();
    }, { timeout: 30000 });

    // Assert
    const text = await output.getText();
    expect(text).toContain("hello");
  });
});
```

## Selectors

Use these data attributes for reliable element selection:

| Selector | Element |
|----------|---------|
| `[data-cell-type="code"]` | Code cell container |
| `[data-cell-id="..."]` | Cell by ID |
| `[data-testid="execute-button"]` | Run cell button |
| `[data-slot="ansi-stream-output"]` | Stream output (stdout/stderr) |
| `.cm-content[contenteditable="true"]` | CodeMirror editor |

## Timeouts

- **App load**: 5 seconds
- **Kernel startup**: 30-60 seconds (first execution)
- **Cell execution**: 15 seconds (after kernel is ready)
- **Element appear**: 5 seconds
