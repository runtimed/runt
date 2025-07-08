// Enhanced Pyodide Web Worker
//
// This worker runs Pyodide with IPython display formatting loaded from
// a separate Python file, but executes user code directly through Pyodide
// to avoid IPython's code transformations. It handles serialization properly
// and provides rich output support with interrupt capabilities.

/// <reference lib="webworker" />

import { loadPyodide, type PyodideInterface } from "npm:pyodide";
import {
  getBootstrapPackages,
  getCacheConfig,
  getEssentialPackages,
  isFirstRun,
} from "./cache-utils.ts";

declare const self: DedicatedWorkerGlobalScope;

let pyodide: PyodideInterface | null = null;
let interruptBuffer: SharedArrayBuffer | null = null;

// Global error handler for uncaught worker errors
self.addEventListener("error", (event) => {
  self.postMessage({
    type: "log",
    data: `Worker uncaught error: ${event.message}`,
  });
});

// Global handler for unhandled promise rejections
self.addEventListener("unhandledrejection", (event) => {
  // Check if this is a KeyboardInterrupt
  if (event.reason && typeof event.reason === "object") {
    const errorStr = event.reason.toString();
    if (errorStr.includes("KeyboardInterrupt")) {
      // This is expected during cancellation - prevent default handling
      // but don't send duplicate error messages since executePython handles it
      event.preventDefault();
      return;
    }
  }

  self.postMessage({
    type: "log",
    data: `Worker unhandled rejection: ${event.reason}`,
  });
});

// Handle messages from main thread
self.addEventListener("message", async (event) => {
  const { id, type, data } = (event as MessageEvent).data;

  try {
    switch (type) {
      case "init": {
        await initializePyodide(
          data.interruptBuffer,
          data.packages,
        );
        self.postMessage({ id, type: "response", data: { success: true } });
        break;
      }

      case "execute": {
        const result = await executePython(data.code);
        self.postMessage({ id, type: "response", data: result });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      id,
      type: "response",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Initialize Pyodide with advanced IPython integration
 */
async function initializePyodide(
  buffer: SharedArrayBuffer,
  packagesToLoad?: string[],
): Promise<void> {
  self.postMessage({
    type: "log",
    data: "Loading Pyodide with enhanced display support",
  });

  // Store interrupt buffer
  interruptBuffer = buffer;

  // Get cache configuration and packages to load
  const { packageCacheDir } = getCacheConfig();
  const basePackages = packagesToLoad || getEssentialPackages();
  const firstRun = isFirstRun();

  // Bootstrap with minimal packages for initial setup
  const bootstrapPackages = getBootstrapPackages();

  // Remaining packages to load after bootstrap
  const remainingPackages = basePackages.filter(
    (pkg) => !bootstrapPackages.includes(pkg),
  );

  self.postMessage({
    type: "log",
    data: `Using cache directory: ${packageCacheDir}`,
  });

  self.postMessage({
    type: "log",
    data: firstRun
      ? `First run detected - loading ${bootstrapPackages.length} bootstrap packages with Pyodide, ${remainingPackages.length} additional packages in background`
      : `Cached packages available - loading ${bootstrapPackages.length} bootstrap packages with Pyodide, ${remainingPackages.length} additional packages in parallel`,
  });

  // Load Pyodide with bootstrap packages for maximum efficiency
  pyodide = await loadPyodide({
    packageCacheDir,
    packages: bootstrapPackages, // Load bootstrap packages during Pyodide initialization
    stdout: (text: string) => {
      // Log startup messages to our telemetry for debugging
      self.postMessage({
        type: "log",
        data: `[Pyodide stdout on startup]: ${text}`,
      });
      self.postMessage({
        type: "stream_output",
        data: { type: "stdout", text },
      });
    },
    stderr: (text: string) => {
      // Log startup errors to our telemetry for debugging
      self.postMessage({
        type: "log",
        data: `[Pyodide stderr on startup]: ${text}`,
      });
      self.postMessage({
        type: "stream_output",
        data: { type: "stderr", text },
      });
    },
  });

  // Set up interrupt buffer
  if (interruptBuffer) {
    const interruptView = new Int32Array(interruptBuffer);
    pyodide.setInterruptBuffer(interruptView);
    self.postMessage({ type: "log", data: "Interrupt buffer configured" });
  }

  // Bootstrap packages were loaded during Pyodide initialization
  self.postMessage({
    type: "log",
    data: `Bootstrap packages (${
      bootstrapPackages.join(", ")
    }) loaded with Pyodide`,
  });

  // Load our Python bootstrap file - bootstrap packages are already available
  await setupIPythonEnvironment();

  // Load remaining packages in background after IPython is ready
  if (remainingPackages.length > 0) {
    self.postMessage({
      type: "log",
      data:
        `Loading ${remainingPackages.length} additional packages in background: ${
          remainingPackages.join(", ")
        }`,
    });

    // Load remaining packages in background without blocking
    pyodide.loadPackage(remainingPackages).then(() => {
      self.postMessage({
        type: "log",
        data:
          `Successfully loaded ${remainingPackages.length} additional packages`,
      });
    }).catch((error) => {
      self.postMessage({
        type: "log",
        data: `Warning: Some additional packages failed to load: ${error}`,
      });
      // Don't throw - IPython is already working
    });
  }

  // Switch to raw write handler for stdout to capture all bytes
  pyodide.setStdout({
    write: (buffer: Uint8Array) => {
      // Convert buffer to text
      const text = new TextDecoder().decode(buffer);

      // Send stdout immediately without coalescing to preserve newlines
      if (text) {
        self.postMessage({
          type: "stream_output",
          data: { type: "stdout", text },
        });
      }

      return buffer.length;
    },
    isatty: true,
  });

  pyodide.setStderr({
    write: (buffer: Uint8Array) => {
      // Convert buffer to text
      const text = new TextDecoder().decode(buffer);

      // Send stderr immediately without coalescing to be consistent with stdout
      if (text) {
        self.postMessage({
          type: "stream_output",
          data: { type: "stderr", text },
        });
      }

      return buffer.length;
    },
    isatty: true,
  });

  self.postMessage({
    type: "log",
    data: "Enhanced Pyodide worker initialized successfully",
  });
}

/**
 * Set up IPython environment by loading the bootstrap Python file
 */
async function setupIPythonEnvironment(): Promise<void> {
  self.postMessage({
    type: "log",
    data: "Loading IPython environment from bootstrap file",
  });

  // Get the Python bootstrap code
  const pythonBootstrap = await fetch(
    new URL("./ipython-setup.py", import.meta.url),
  ).then((response) => response.text());

  // Execute the bootstrap code
  await pyodide!.runPythonAsync(pythonBootstrap);

  self.postMessage({
    type: "log",
    data: "IPython environment loaded successfully",
  });

  // Install micropip packages in background without blocking
  // Skip during tests to prevent execution interference
  const isTest = globalThis.Deno?.env?.get("DENO_TESTING") === "true" ||
    globalThis.location?.search?.includes("test");

  if (!isTest) {
    // Use setTimeout to isolate from execution pipeline
    setTimeout(() => {
      pyodide!.runPythonAsync(`await bootstrap_micropip_packages()`).then(
        () => {
          self.postMessage({
            type: "log",
            data: "Micropip packages installed successfully",
          });
        },
      ).catch((error) => {
        self.postMessage({
          type: "log",
          data: `Warning: Micropip package installation failed: ${error}`,
        });
      });
    }, 100);
  } else {
    self.postMessage({
      type: "log",
      data: "Skipping micropip bootstrap during tests",
    });
  }
}

/**
 * Execute Python code with rich output capture and proper serialization
 */
async function executePython(code: string): Promise<{
  result: unknown;
}> {
  if (!pyodide) {
    throw new Error("Pyodide not initialized");
  }

  let result = null;
  let executionError = null;

  self.postMessage({
    type: "log",
    data: "Starting Python execution with interrupt support",
  });

  try {
    // Set up JavaScript callbacks with proper serialization
    pyodide.globals.set(
      "js_display_callback",
      (
        data: unknown,
        metadata: unknown,
        transient: unknown,
        update = false,
      ) => {
        try {
          // Ensure data is serializable
          const serializedData = ensureSerializable(data);
          const serializedMetadata = ensureSerializable(metadata);
          const serializedTransient = ensureSerializable(transient);

          const outputType = update ? "update_display_data" : "display_data";

          self.postMessage({
            type: "stream_output",
            data: {
              type: outputType,
              data: serializedData,
              metadata: serializedMetadata,
              transient: serializedTransient,
            },
          });

          // Don't accumulate display events in outputs array to prevent memory leak
          // Display events are already streamed via postMessage -> ExecutionContext
        } catch (error) {
          self.postMessage({
            type: "log",
            data: `Error in display callback: ${error}`,
          });
          self.postMessage({
            type: "stream_output",
            data: {
              type: "error",
              data: {
                ename: "SerializationError",
                evalue: `Error serializing display data: ${error}`,
                traceback: [String(error)],
              },
            },
          });
        }
      },
    );

    pyodide.globals.set(
      "js_execution_callback",
      (execution_count: number, data: unknown, metadata: unknown) => {
        try {
          // Ensure data is serializable
          const serializedData = ensureSerializable(data);
          const serializedMetadata = ensureSerializable(metadata);

          self.postMessage({
            type: "stream_output",
            data: {
              type: "execute_result",
              data: serializedData,
              metadata: serializedMetadata,
              execution_count,
            },
          });

          // Don't accumulate in outputs - streaming directly to ExecutionContext
        } catch (error) {
          self.postMessage({
            type: "log",
            data: `Error in execution callback: ${error}`,
          });
          self.postMessage({
            type: "stream_output",
            data: {
              type: "error",
              data: {
                ename: "SerializationError",
                evalue: `Error serializing execution result: ${error}`,
                traceback: [String(error)],
              },
            },
          });
        }
      },
    );

    pyodide.globals.set(
      "js_clear_callback",
      (wait: boolean = false) => {
        try {
          self.postMessage({
            type: "stream_output",
            data: {
              type: "clear_output",
              wait: wait,
            },
          });
        } catch (error) {
          self.postMessage({
            type: "log",
            data: `Error in clear callback: ${error}`,
          });
        }
      },
    );

    // Set up interrupt checking function for Python
    pyodide.globals.set(
      "pyodide_check_interrupt",
      () => {
        if (pyodide) {
          try {
            pyodide.checkInterrupt();
          } catch (error) {
            // Log the interrupt detection and re-throw
            self.postMessage({
              type: "log",
              data: `Interrupt detected via pyodide_check_interrupt: ${error}`,
            });
            throw error;
          }
        }
      },
    );

    // Wire up the callbacks to the shell
    await pyodide.runPythonAsync(`
# Connect our JavaScript callbacks to the IPython shell
shell.display_pub.js_callback = js_display_callback
shell.display_pub.js_clear_callback = js_clear_callback
shell.displayhook.js_callback = js_execution_callback

# Make clear_output available globally for users
from IPython.display import clear_output

# Make interrupt checking available to Python patches
import builtins
builtins.pyodide_check_interrupt = pyodide_check_interrupt
`);

    // Execute the code directly with Pyodide (no IPython transformations)
    try {
      // Check for interrupt before execution
      pyodide.checkInterrupt();

      self.postMessage({
        type: "log",
        data: "Pre-execution interrupt check passed, executing code",
      });

      try {
        // Execute the user code directly
        const rawResult = await pyodide.runPythonAsync(code);

        self.postMessage({
          type: "log",
          data: "Code execution completed successfully",
        });

        // If there's a result, format it through IPython's display system
        if (rawResult !== null && rawResult !== undefined) {
          // Store the result in Python globals and format it
          pyodide.globals.set("_pyodide_result", rawResult);
          await pyodide.runPythonAsync(`
# Format the result through IPython's displayhook for rich formatting
if '_pyodide_result' in globals():
    shell.displayhook(_pyodide_result)
    del _pyodide_result
`);
          // Don't return the result since displayhook already handled it
          result = null;
        } else {
          result = rawResult;
        }
      } catch (pythonError: unknown) {
        // Handle KeyboardInterrupt that occurs during async execution
        if (pythonError && typeof pythonError === "object") {
          const errorStr = pythonError.toString();
          if (errorStr.includes("KeyboardInterrupt")) {
            self.postMessage({
              type: "log",
              data: "KeyboardInterrupt detected during execution",
            });
            // Handle KeyboardInterrupt as execution error - don't throw
            executionError = {
              ename: "ExecutionCancelled",
              evalue: "Execution was cancelled",
              traceback: [],
            };
          } else {
            self.postMessage({
              type: "log",
              data: `Python error during execution: ${errorStr}`,
            });
            executionError = formatPythonError(pythonError);
          }
        } else {
          self.postMessage({
            type: "log",
            data: `Unknown error during execution: ${pythonError}`,
          });
          executionError = formatPythonError(pythonError);
        }
      }
    } catch (preExecutionError: unknown) {
      // Handle errors from checkInterrupt() or other pre-execution issues
      if (preExecutionError && typeof preExecutionError === "object") {
        const errorStr = preExecutionError.toString();
        if (errorStr.includes("KeyboardInterrupt")) {
          self.postMessage({
            type: "log",
            data: "KeyboardInterrupt detected before execution",
          });
          executionError = {
            ename: "ExecutionCancelled",
            evalue: "Execution was cancelled",
            traceback: [],
          };
        } else {
          self.postMessage({
            type: "log",
            data: `Pre-execution error: ${errorStr}`,
          });
          executionError = formatPythonError(preExecutionError);
        }
      } else {
        self.postMessage({
          type: "log",
          data: `Unknown pre-execution error: ${preExecutionError}`,
        });
        executionError = formatPythonError(preExecutionError);
      }
    }
  } catch (err: unknown) {
    executionError = {
      ename: "RuntimeError",
      evalue: err instanceof Error ? err.message : "Runtime execution failed",
      traceback: [
        err instanceof Error ? (err.stack || err.message) : String(err),
      ],
    };
  }

  // Send error if one occurred
  if (executionError) {
    self.postMessage({
      type: "stream_output",
      data: { type: "error", data: executionError },
    });
  }

  return {
    result: ensureSerializable(result),
  };
}

/**
 * Ensure data is serializable for postMessage
 */
function ensureSerializable(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitive types
  if (
    typeof obj === "string" || typeof obj === "number" ||
    typeof obj === "boolean"
  ) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(ensureSerializable);
  }

  // Handle objects
  if (typeof obj === "object") {
    // Handle PyProxy objects from Pyodide
    if (obj && typeof obj === "object" && "toJs" in obj) {
      try {
        const jsObj = (obj as { toJs: () => unknown }).toJs();
        return ensureSerializable(jsObj);
      } catch {
        return String(obj);
      }
    }

    // Handle Map objects
    if (obj instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of obj) {
        result[String(key)] = ensureSerializable(value);
      }
      return result;
    }

    // Handle Set objects
    if (obj instanceof Set) {
      return Array.from(obj).map(ensureSerializable);
    }

    // Handle regular objects
    try {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = ensureSerializable(value);
      }
      return result;
    } catch {
      return String(obj);
    }
  }

  // Fallback to string representation
  return String(obj);
}

/**
 * Format Python errors with enhanced information
 */
function formatPythonError(error: unknown): {
  ename: string;
  evalue: string;
  traceback: string[];
} {
  if (!error) {
    return {
      ename: "UnknownError",
      evalue: "Unknown Python error occurred",
      traceback: ["Unknown Python error occurred"],
    };
  }

  if (error && typeof error === "object") {
    // Handle Pyodide PyProxy errors
    if ("toString" in error && typeof error.toString === "function") {
      try {
        const errorStr = error.toString();

        // Parse Python traceback format
        if (errorStr.includes("Traceback")) {
          const lines = errorStr.split("\n").filter((line) => line.trim());
          const lastLine = lines[lines.length - 1] || "";
          const match = lastLine.match(/^(\w+(?:Error)?): (.*)$/);

          if (match && match[1] && match[2]) {
            return {
              ename: match[1],
              evalue: match[2],
              traceback: lines,
            };
          }
        }

        // Handle simple error format
        if (errorStr.includes("Error:")) {
          const match = errorStr.match(/^(\w+(?:Error)?): (.*)$/);
          if (match && match[1] && match[2]) {
            return {
              ename: match[1],
              evalue: match[2],
              traceback: [errorStr],
            };
          }
        }

        return {
          ename: "PythonError",
          evalue: errorStr,
          traceback: [errorStr],
        };
      } catch {
        // Fallback if toString fails
      }
    }

    // Handle structured error objects
    if ("type" in error && "message" in error) {
      return {
        ename: String(error.type),
        evalue: String(error.message),
        traceback: [String(error.message)],
      };
    }

    if ("message" in error) {
      return {
        ename: "PythonError",
        evalue: String(error.message),
        traceback: [String(error.message)],
      };
    }
  }

  // Ultimate fallback
  const errorStr = String(error);
  return {
    ename: "PythonError",
    evalue: errorStr,
    traceback: [errorStr],
  };
}

// Log that enhanced worker is ready
self.postMessage({
  type: "log",
  data: "Enhanced Pyodide worker ready with serialization-safe output",
});
