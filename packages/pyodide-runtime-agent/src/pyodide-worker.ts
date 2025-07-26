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

      case "get_registered_tools": {
        const result = await pyodide!.runPythonAsync(`get_registered_tools()`);
        const parsed = JSON.parse(result);
        self.postMessage({ id, type: "response", data: parsed });
        break;
      }

      case "run_registered_tool": {
        try {
          // Pass arguments as JSON string directly to registry
          pyodide!.globals.set(
            "kwargs_string",
            JSON.stringify(data.args || {}),
          );
          const result = await pyodide!.runPythonAsync(`
await run_registered_tool("${data.toolName}", kwargs_string)
          `.trim());
          self.postMessage({ id, type: "response", data: result });
        } catch (error) {
          // Send back the Python error details for debugging
          const errorMessage = error instanceof Error
            ? error.message
            : String(error);
          self.postMessage({
            id,
            type: "error",
            error: errorMessage,
          });

          // Also log to console for debugging
          console.error(`Tool execution failed for ${data.toolName}:`, error);
        }
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
  try {
    await setupIPythonEnvironment();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: "log",
      data: `Failed to setup IPython environment: ${errorMessage}`,
    });
    throw new Error(`IPython setup failed: ${errorMessage}`);
  }

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

  // Install pydantic first (required by registry.py)
  await pyodide!.loadPackage("pydantic");

  // Execute registry.py to make classes available globally
  const registryCode = `
"""Registry of functions.

Original from https://github.com/rgbkrk/chatlab/blob/main/chatlab/registry.py
"""

import asyncio
import inspect
import json
from typing import (
    Any,
    Callable,
    Dict,
    Iterable,
    List,
    Optional,
    Type,
    TypeAlias,
    TypedDict,
    Required,
    Union,
    cast,
    get_args,
    get_origin,
    overload,
)

from pydantic import BaseModel, Field, create_model

FunctionParameters: TypeAlias = Dict[str, object]


class FunctionDefinition(TypedDict, total=False):
    name: Required[str]
    """The name of the function to be called.

    Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length
    of 64.
    """

    description: str
    """
    A description of what the function does, used by the model to choose when and
    how to call the function.
    """

    parameters: FunctionParameters
    """The parameters the functions accepts, described as a JSON Schema object.

    See the [guide](https://platform.openai.com/docs/guides/function-calling) for
    examples, and the
    [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
    documentation about the format.

    Omitting \`parameters\` defines a function with an empty parameter list.
    """

    strict: Optional[bool]
    """Whether to enable strict schema adherence when generating the function call.

    If set to true, the model will follow the exact schema defined in the
    \`parameters\` field. Only a subset of JSON Schema is supported when \`strict\` is
    \`true\`. Learn more about Structured Outputs in the
    [function calling guide](https://platform.openai.com/docs/guides/function-calling).
    """


class FunctionError(Exception):
    """Exception raised when a function encounters an error."""

    pass


class FunctionArgumentError(FunctionError):
    """Exception raised when a function is called with invalid arguments."""

    pass


class UnknownFunctionError(FunctionError):
    """Exception raised when a function is called that is not registered."""

    pass


# Allowed types for auto-inferred schemas
ALLOWED_TYPES = [int, str, bool, float, list, dict, List, Dict]

JSON_SCHEMA_TYPES = {
    int: "integer",
    float: "number",
    str: "string",
    bool: "boolean",
    list: "array",
    dict: "object",
    List: "array",
    Dict: "object",
}


def is_optional_type(t):
    """Check if a type is Optional."""
    return (
        get_origin(t) is Union and len(get_args(t)) == 2 and type(None) in get_args(t)
    )


def is_union_type(t):
    """Check if a type is a Union."""
    return get_origin(t) is Union


class FunctionSchemaConfig:
    """Config used for model generation during function schema creation."""

    arbitrary_types_allowed = True


def extract_model_from_function(func_name: str, function: Callable) -> Type[BaseModel]:
    # extract function parameters and their type annotations
    sig = inspect.signature(function)

    fields = {}
    required_fields = []
    for name, param in sig.parameters.items():
        # skip 'self' for class methods
        if name == "self":
            continue

        # determine type annotation
        if param.annotation == inspect.Parameter.empty:
            # no annotation, raise instead of falling back to Any
            raise Exception(
                f"\`{name}\` parameter of {func_name} must have a JSON-serializable type annotation"
            )
        type_annotation = param.annotation

        default_value: Any = ...

        # determine if there is a default value
        if param.default != inspect.Parameter.empty:
            default_value = param.default
        else:
            required_fields.append(name)

        # Check if the annotation is Union that includes None, indicating an optional parameter
        if get_origin(type_annotation) is Union:
            args = get_args(type_annotation)
            if len(args) == 2 and type(None) in args:
                type_annotation = next(arg for arg in args if arg is not type(None))
                default_value = None

        fields[name] = (
            type_annotation,
            Field(default=default_value) if default_value is not ... else ...,
        )

    model = create_model(
        function.__name__,
        __config__=FunctionSchemaConfig,  # type: ignore
        **fields,  # type: ignore
    )
    return model


def generate_function_schema(
    function: Callable,
    parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
) -> FunctionDefinition:
    """Generate a function schema for sending to OpenAI."""
    doc = function.__doc__
    func_name = function.__name__

    if not func_name:
        raise Exception("Function must have a name")
    if func_name == "<lambda>":
        raise Exception("Lambdas cannot be registered. Use \`def\` instead.")
    if not doc:
        raise Exception("Only functions with docstrings can be registered")

    if isinstance(parameter_schema, dict):
        parameters = parameter_schema
    elif parameter_schema is not None:
        parameters = parameter_schema.model_json_schema()  # type: ignore
    else:
        model = extract_model_from_function(func_name, function)
        parameters: dict = model.model_json_schema()  # type: ignore

    if "properties" not in parameters:
        parameters["properties"] = {}

    # remove "title" since it's unused by OpenAI
    parameters.pop("title", None)
    for field_name in parameters["properties"].keys():
        parameters["properties"][field_name].pop("title", None)

    if "required" not in parameters:
        parameters["required"] = []

    schema = FunctionDefinition(
        name=func_name,
        description=doc,
        parameters=parameters,
    )
    return schema


class FunctionRegistry:
    """Registry of functions and their schemas for calling them."""

    __functions: dict[str, Callable]
    __schemas: dict[str, FunctionDefinition]

    # Allow passing in a callable that accepts a single string for the python
    # hallucination function. This is useful for testing.
    def __init__(
        self,
    ):
        """Initialize a FunctionRegistry object."""
        self.__functions = {}
        self.__schemas = {}

    def decorator(
        self, parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None
    ) -> Callable:
        """Create a decorator for registering functions with a schema."""

        def decorator(function):
            self.register_function(function, parameter_schema)
            return function

        return decorator

    @overload
    def register(
        self,
        function: None = None,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> Callable: ...

    @overload
    def register(
        self,
        function: Callable,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> FunctionDefinition: ...

    def register(
        self,
        function: Optional[Callable] = None,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> Union[Callable, FunctionDefinition]:
        """Register a function. Can be used as a decorator or directly to register a function.

        >>> registry = FunctionRegistry()
        >>> @registry.register
        ... def what_time(tz: Optional[str] = None):
        ...     '''Current time, defaulting to the user's current timezone'''
        ...     if tz is None:
        ...         pass
        ...     elif tz in all_timezones:
        ...         tz = timezone(tz)
        ...     else:
        ...         return 'Invalid timezone'
        ...     return datetime.now(tz).strftime('%I:%M %p')
        >>> registry.get("what_time")
        <function __main__.what_time(tz: Optional[str] = None)>
        >>> await registry.call("what_time", '{"tz": "America/New_York"}')
        '10:57 AM'

        """
        # If the function is None, assume this is a decorator call
        if function is None:
            return self.decorator(parameter_schema)

        # Otherwise, directly register the function
        return self.register_function(function, parameter_schema)

    def register_function(
        self,
        function: Callable,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> FunctionDefinition:
        """Register a single function."""
        final_schema = generate_function_schema(function, parameter_schema)

        self.__functions[function.__name__] = function
        self.__schemas[function.__name__] = final_schema

        return final_schema

    def register_functions(
        self, functions: Union[Iterable[Callable], dict[str, Callable]]
    ):
        """Register a dictionary of functions."""
        if isinstance(functions, dict):
            functions = functions.values()

        for function in functions:
            self.register(function)

    def get(self, function_name) -> Optional[Callable]:
        """Get a function by name."""
        return self.__functions.get(function_name)

    def get_schema(self, function_name) -> Optional[FunctionDefinition]:
        """Get a function schema by name."""
        return self.__schemas.get(function_name)

    async def call(self, name: str, arguments: Optional[str] = None) -> Any:
        """Call a function by name with the given parameters."""
        if name is None:
            raise UnknownFunctionError("Function name must be provided")

        possible_function = self.get(name)

        if possible_function is None:
            raise UnknownFunctionError(f"Function {name} is not registered")

        function = possible_function

        # TODO: Use the model extractor here
        prepared_arguments = extract_arguments(name, function, arguments)

        if asyncio.iscoroutinefunction(function):
            result = await function(**prepared_arguments)
        else:
            result = function(**prepared_arguments)
        return result

    def __contains__(self, name) -> bool:
        """Check if a function is registered by name."""
        return name in self.__functions

    @property
    def function_definitions(self) -> list[FunctionDefinition]:
        """Get a list of function definitions."""
        return list(self.__schemas.values())


def extract_arguments(name: str, function: Callable, arguments: Optional[str]) -> dict:
    dict_arguments = {}
    if arguments is not None and arguments != "":
        try:
            dict_arguments = json.loads(arguments)
        except json.JSONDecodeError:
            raise FunctionArgumentError(
                f"Invalid Function call on {name}. Arguments must be a valid JSON object"
            )

    prepared_arguments = {}

    for param_name, param in inspect.signature(function).parameters.items():
        param_type = param.annotation
        arg_value = dict_arguments.get(param_name)

        # Check if parameter type is a subclass of BaseModel and deserialize JSON into Pydantic model
        if inspect.isclass(param_type) and issubclass(param_type, BaseModel):
            prepared_arguments[param_name] = param_type.model_validate(arg_value)
        else:
            prepared_arguments[param_name] = cast(Any, arg_value)

    return prepared_arguments
`;

  await pyodide!.runPythonAsync(registryCode);

  // Execute simplified IPython setup
  const ipythonSetup = `
import sys
import io
import json
import logging
import traceback
from typing import Callable

# Core dependencies
from IPython import get_ipython
from IPython.core.displayhook import DisplayHook
from IPython.core.history import HistoryManager
from IPython.terminal.interactiveshell import TerminalInteractiveShell
import matplotlib
import matplotlib.pyplot as plt

# Configure matplotlib for headless PNG output (works in Deno workers)
matplotlib.use("Agg")

# Suppress matplotlib font warnings in console
logging.getLogger("matplotlib.font_manager").setLevel(logging.WARNING)

# Simple interrupt handling
import signal
import time
import builtins

def setup_interrupt_patches():
    """Basic interrupt handling without complex patches."""
    original_sleep = time.sleep

    def interrupt_aware_sleep(duration):
        if duration <= 0:
            return
        chunk_size = 0.05
        remaining = float(duration)
        while remaining > 0:
            sleep_time = min(chunk_size, remaining)
            original_sleep(sleep_time)
            remaining -= sleep_time

    time.sleep = interrupt_aware_sleep
    print("Basic interrupt handling installed")

setup_interrupt_patches()

# Set up IPython environment
shell = get_ipython()
if not shell:
    shell = TerminalInteractiveShell.instance()

# Create global function registry instance
_function_registry = FunctionRegistry()

# Tool decorator and functions
def tool(func: Callable) -> Callable:
    """Decorator to register a function as a tool"""
    _function_registry.register(func)
    return func

def get_registered_tools():
    """Get all registered tools as JSON string"""
    tools = _function_registry.function_definitions
    return json.dumps(tools, default=str)

async def run_registered_tool(toolName: str, kwargs_string: str):
    """Run a registered tool by name"""
    try:
        result = await _function_registry.call(toolName, kwargs_string)
        if not isinstance(result, str):
            result = json.dumps(result, default=str)
        return result
    except UnknownFunctionError:
        raise Exception(f"Tool {toolName} not found")
    except (FunctionArgumentError, FunctionError) as e:
        print(f"[TOOL_ERROR] Error running tool {toolName}: {e}")
        raise
    except Exception as e:
        import traceback
        tb_str = traceback.format_exc()
        error_msg = f"Tool '{toolName}' execution failed with error: {str(e)}"
        print(f"[TOOL_ERROR] {error_msg}", file=sys.stderr)
        print(f"[TOOL_TRACEBACK] {tb_str}", file=sys.stderr)
        raise Exception(f"{error_msg}\\n\\nPython traceback:\\n{tb_str}")

print("IPython environment ready with rich display support")
print("Interrupt-aware function patches applied with enhanced signal handling")
`;

  await pyodide!.runPythonAsync(ipythonSetup);

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
    // Micropip bootstrap not needed in simplified setup
    self.postMessage({
      type: "log",
      data: "Skipping micropip bootstrap in simplified setup",
    });
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
