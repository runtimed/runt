"""
IPython environment setup for Runt Pyodide runtime.

This module configures the IPython environment with:
- Rich display support for matplotlib, pandas, etc.
- Custom display publishers and hooks
- Function registry for tools
- Interrupt handling patches
"""

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

# Import from our package modules
from .registry import (
    FunctionRegistry,
    UnknownFunctionError,
    FunctionArgumentError,
    FunctionError,
)
from .interrupts import setup_interrupt_patches

# Configure matplotlib for headless PNG output (works in Deno workers)
matplotlib.use("Agg")

# Suppress matplotlib font warnings in console
logging.getLogger("matplotlib.font_manager").setLevel(logging.WARNING)


class LiteHistoryManager(HistoryManager):
    """Lightweight history manager that doesn't persist to disk"""

    def __init__(self, shell=None, **traits):
        super().__init__(shell=shell, **traits)


class RichDisplayPublisher:
    """Custom display publisher that captures rich output for streaming"""

    def __init__(self, display_callback=None):
        self.display_callback = display_callback or default_display_callback

    def publish(
        self,
        data,
        metadata=None,
        source=None,
        transient=None,
        update=False,
        **kwargs,
    ):
        """Publish display data through our callback system"""
        try:
            # Send through our callback system for streaming
            self.display_callback(
                self._make_serializable(data),
                self._make_serializable(metadata) if metadata else {},
                self._make_serializable(transient) if transient else {},
                update,
            )
        except Exception as e:
            print(f"Error in display publisher: {e}")

    def clear_output(self, wait=False):
        """Clear the output area"""
        try:
            default_clear_callback(wait)
        except Exception as e:
            print(f"Error clearing output: {e}")

    def _make_serializable(self, obj):
        """Ensure object is JSON serializable"""
        if obj is None:
            return None
        if isinstance(obj, (dict, list, str, int, float, bool)):
            return obj
        try:
            return json.loads(json.dumps(obj, default=str))
        except (TypeError, ValueError):
            return str(obj)


class RichDisplayHook(DisplayHook):
    """Custom display hook that captures execution results"""

    def __init__(self, shell=None, execution_callback=None):
        super().__init__(shell=shell)
        self.execution_callback = execution_callback or default_execution_callback

    def __call__(self, result=None):
        """Handle execution results with rich formatting"""
        if result is None:
            return

        try:
            # Format the result using IPython's formatting system
            formatted_result = self.shell.display_formatter.format(result)

            if formatted_result[0]:  # If there's formatted output
                self.execution_callback(
                    self.shell.execution_count,
                    self._make_serializable(formatted_result[0]),
                    self._make_serializable(formatted_result[1]),
                )
        except Exception as e:
            print(f"Error in display hook: {e}")

    def _make_serializable(self, obj):
        """Ensure object is JSON serializable"""
        if obj is None:
            return None
        if isinstance(obj, (dict, list, str, int, float, bool)):
            return obj
        try:
            return json.loads(json.dumps(obj, default=str))
        except (TypeError, ValueError):
            return str(obj)


def _capture_matplotlib_show():
    """Capture matplotlib.pyplot.show() calls for rich display"""
    _original_show = plt.show

    def captured_show(*args, **kwargs):
        """Show matplotlib figures through display system"""
        try:
            # Get current figure
            fig = plt.gcf()
            if fig.get_axes():
                # Save to bytes buffer
                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
                buf.seek(0)

                # Create display data
                png_data = buf.getvalue()
                import base64

                png_b64 = base64.b64encode(png_data).decode("utf-8")

                display_data = {
                    "image/png": png_b64,
                    "text/plain": f"<matplotlib figure {id(fig)}>",
                }

                # Send through display system
                default_display_callback(display_data, {}, {}, False)

                # Clear the figure to prevent duplicate displays
                plt.clf()
        except Exception as e:
            print(f"Error capturing matplotlib show: {e}")
            # Fallback to original show
            _original_show(*args, **kwargs)

    # Patch matplotlib
    plt.show = captured_show


def setup_rich_formatters():
    """Set up rich formatters for common data types"""
    shell = get_ipython()
    if not shell:
        return

    # Enable rich display for pandas, numpy, etc.
    try:
        shell.enable_matplotlib("inline")
    except Exception:
        pass  # matplotlib might not be fully set up yet


def format_exception(exc_type, exc_value, tb):
    """Format exception with full traceback for debugging"""
    try:
        return "".join(traceback.format_exception(exc_type, exc_value, tb))
    except Exception:
        return f"{exc_type.__name__}: {exc_value}"


# Default callback functions (will be replaced by worker)
def default_display_callback(data, metadata, transient, update=False):
    """Default display callback - prints to console"""
    print(f"Display: {data}")


def default_execution_callback(execution_count, data, metadata):
    """Default execution callback - prints to console"""
    print(f"[{execution_count}]: {data}")


def default_clear_callback(wait=False):
    """Default clear callback - does nothing"""
    pass


async def bootstrap_micropip_packages():
    """Bootstrap micropip packages for enhanced functionality"""
    try:
        import micropip

        # Load essential packages for function registry
        packages = ["annotated-types", "pydantic", "pydantic_core", "typing-extensions"]
        print(f"Loading {', '.join(packages)}")
        await micropip.install(packages)
        print(f"Loaded {', '.join(packages)}")
    except Exception as e:
        print(f"Warning: Failed to install packages: {e}")


# Set up IPython environment
shell = get_ipython()
if not shell:
    # Create IPython instance if none exists
    shell = TerminalInteractiveShell.instance()

# Configure shell
shell.history_manager = LiteHistoryManager(shell=shell)
shell.display_pub = RichDisplayPublisher()
shell.displayhook = RichDisplayHook(shell=shell)

# Set up matplotlib capture
_capture_matplotlib_show()

# Set up rich formatters
setup_rich_formatters()

print("IPython environment ready with rich display support")

# Set up interrupt patches
setup_interrupt_patches()

# Create global function registry instance
_function_registry = FunctionRegistry()


# Exception classes for compatibility
class ToolNotFoundError(Exception):
    """Compatibility alias for UnknownFunctionError"""

    pass


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
        # Pass JSON string directly to registry
        result = await _function_registry.call(toolName, kwargs_string)

        # Ensure result is JSON serializable string
        if not isinstance(result, str):
            result = json.dumps(result, default=str)

        return result

    except UnknownFunctionError:
        raise ToolNotFoundError(f"Tool {toolName} not found")
    except (FunctionArgumentError, FunctionError) as e:
        # Log the error for debugging
        print(f"[TOOL_ERROR] Error running tool {toolName}: {e}")
        raise
    except Exception as e:
        # Capture and format any other Python exceptions from tool execution
        import traceback

        # Format the full traceback for debugging
        tb_str = traceback.format_exc()
        error_msg = f"Tool '{toolName}' execution failed with error: {str(e)}"

        # Print the full traceback to stderr for logging
        print(f"[TOOL_ERROR] {error_msg}", file=sys.stderr)
        print(f"[TOOL_TRACEBACK] {tb_str}", file=sys.stderr)

        # Raise a clear error that includes the Python error details
        raise Exception(f"{error_msg}\n\nPython traceback:\n{tb_str}")


# Export the configured shell and registry functions for use by the worker
__all__ = [
    "shell",
    "get_registered_tools",
    "run_registered_tool",
    "tool",
    "_function_registry",
    "ToolNotFoundError",
]
