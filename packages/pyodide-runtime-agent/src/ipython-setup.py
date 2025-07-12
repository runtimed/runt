"""
IPython Bootstrap Setup for Enhanced Pyodide Runtime

This module sets up a complete IPython environment with rich display support,
matplotlib integration, enhanced error formatting, and proper output handling.

Note: For HTTPS requests, use the `requests` library instead of urllib:
    import requests
    import pandas as pd
    from io import StringIO

    response = requests.get("https://example.com/data.csv")
    df = pd.read_csv(StringIO(response.text))
"""

import os
import sys
import io
import json

from IPython.core.interactiveshell import InteractiveShell
from IPython.core.displayhook import DisplayHook
from IPython.core.displaypub import DisplayPublisher
from IPython.core.history import HistoryManager
import matplotlib
import matplotlib.pyplot as plt

# Configure matplotlib for rich PNG output
matplotlib.use("agg")
plt.rcParams["figure.dpi"] = 150
plt.rcParams["savefig.dpi"] = 150
plt.rcParams["figure.facecolor"] = "white"
plt.rcParams["savefig.facecolor"] = "white"
plt.rcParams["figure.figsize"] = (8, 6)

# Set up environment for rich terminal output
os.environ.update(
    {
        "TERM": "xterm-256color",
        "FORCE_COLOR": "1",
        "COLORTERM": "truecolor",
        "CLICOLOR": "1",
        "CLICOLOR_FORCE": "1",
    }
)


class LiteHistoryManager(HistoryManager):
    """Lightweight history manager for web environment"""

    def __init__(self, shell=None, config=None, **traits):
        self.enabled = False
        super().__init__(shell=shell, config=config, **traits)


class RichDisplayPublisher(DisplayPublisher):
    """Enhanced display publisher for rich output handling"""

    def __init__(self, shell=None, *args, **kwargs):
        super().__init__(shell, *args, **kwargs)
        self.js_callback = None

    def publish(
        self,
        data,
        metadata=None,
        source=None,
        *,
        transient=None,
        update=False,
        **kwargs,
    ):
        """Publish display data with proper serialization"""
        if self.js_callback and data:
            # Convert data to serializable format
            serializable_data = self._make_serializable(data)
            serializable_metadata = self._make_serializable(metadata or {})
            serializable_transient = self._make_serializable(transient or {})

            self.js_callback(
                serializable_data, serializable_metadata, serializable_transient, update
            )

    def clear_output(self, wait=False):
        """Clear output signal"""
        if hasattr(self, "js_clear_callback") and self.js_clear_callback:
            self.js_clear_callback(wait)
        else:
            # Fallback - send clear signal via stdout
            print(f"__CLEAR_OUTPUT__:{wait}", flush=True)

    def _make_serializable(self, obj):
        """Convert objects to JSON-serializable format"""
        if obj is None:
            return {}

        if hasattr(obj, "to_dict"):
            return obj.to_dict()

        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                try:
                    # Test if value is JSON serializable
                    json.dumps(value)
                    result[str(key)] = value
                except (TypeError, ValueError) as e:
                    # Log serialization issues to structured logs
                    print(
                        f"[SERIALIZATION_WARNING] Non-serializable value for key '{key}': {e}",
                        flush=True,
                    )
                    # Convert non-serializable values to strings
                    result[str(key)] = str(value)
            return result

        try:
            # Test if object is JSON serializable
            json.dumps(obj)
            return obj
        except (TypeError, ValueError):
            return str(obj)


class RichDisplayHook(DisplayHook):
    """Enhanced display hook for execution results with rich formatting"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.js_callback = None
        self.execution_count = 0

    def __call__(self, result):
        """Handle execution results with proper serialization"""
        if result is not None:
            self.execution_count += 1

            # Format the result using IPython's rich formatting
            try:
                format_dict, md_dict = self.compute_format_data(result)

                # Make data serializable
                if self.js_callback and format_dict:
                    serializable_data = self._make_serializable(format_dict)
                    serializable_metadata = self._make_serializable(md_dict or {})

                    self.js_callback(
                        self.execution_count, serializable_data, serializable_metadata
                    )

            except Exception as e:
                # Log formatting errors to structured logs instead of stderr
                print(
                    f"[DISPLAY_HOOK_ERROR] ErrorWarning: Error formatting result: {e}",
                    file=sys.stderr,
                )
                # Fallback to simple string representation
                if self.js_callback:
                    fallback_data = {"text/plain": str(result)}
                    self.js_callback(self.execution_count, fallback_data, {})

        return result

    def _make_serializable(self, obj):
        """Convert objects to JSON-serializable format"""
        if obj is None:
            return {}

        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                try:
                    # Test if value is JSON serializable
                    json.dumps(value)
                    result[str(key)] = value
                except (TypeError, ValueError) as e:
                    # Log serialization issues to structured logs
                    print(
                        f"[SERIALIZATION_WARNING] Non-serializable value for key '{key}': {e}",
                        flush=True,
                    )
                    # Convert non-serializable values to strings
                    result[str(key)] = str(value)
            return result

        try:
            # Test if object is JSON serializable
            json.dumps(obj)
            return obj
        except (TypeError, ValueError):
            return str(obj)


shell = InteractiveShell.instance(
    displayhook_class=RichDisplayHook,
    display_pub_class=RichDisplayPublisher,
)

# Override history manager
shell.history_manager = LiteHistoryManager(shell=shell, parent=shell)

# Enhanced matplotlib show function with SVG capture
_original_show = plt.show


def _capture_matplotlib_show(block=None):
    """Capture matplotlib plots as PNG and send via display system"""
    if plt.get_fignums():
        fig = plt.gcf()
        png_buffer = io.BytesIO()

        try:
            fig.savefig(
                png_buffer,
                format="png",
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
                dpi=150,
            )
            png_data = png_buffer.getvalue()
            png_buffer.close()

            # Use IPython's display system for PNG
            import base64
            from IPython.display import display

            # Convert to base64 for proper IPython display format
            png_base64 = base64.b64encode(png_data).decode("ascii")

            # Create display data in IPython format
            display_data = {"image/png": png_base64}
            display(display_data, raw=True)

            plt.clf()
        except Exception as e:
            print(f"Error capturing plot: {e}")

    return _original_show(block=block) if block is not None else _original_show()


# Phase 2: Artifact uploader for direct binary upload
class ArtifactUploader:
    """Direct binary upload API for Python runtime"""

    def __init__(self):
        self.threshold = 16384  # 16KB default threshold

    async def upload_binary(self, data: bytes, mime_type: str, metadata: dict = None):
        """Upload binary data directly to artifact service"""
        if metadata is None:
            metadata = {}

        # Convert bytes to Uint8Array for JavaScript
        import js

        uint8_array = js.Uint8Array.new(len(data))
        uint8_array.set(data)

        # Call JavaScript bridge
        artifact_id = await js.js_upload_binary(uint8_array, mime_type, metadata)
        return artifact_id

    async def upload_if_needed(
        self, data: bytes, mime_type: str, threshold: int = None
    ):
        """Upload if over threshold, otherwise return inline container"""
        if threshold is None:
            threshold = self.threshold

        import js

        uint8_array = js.Uint8Array.new(len(data))
        uint8_array.set(data)

        container = await js.js_upload_if_needed(uint8_array, mime_type, threshold)
        return container.to_py()


# Global artifact uploader instance
artifact = ArtifactUploader()


# Enhanced matplotlib show with Phase 2 binary upload
def _capture_matplotlib_show_phase2(block=None):
    """Capture matplotlib plots with artifact-aware output"""
    if plt.get_fignums():
        fig = plt.gcf()
        png_buffer = io.BytesIO()

        try:
            fig.savefig(
                png_buffer,
                format="png",
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
                dpi=150,
            )
            png_data = png_buffer.getvalue()
            png_buffer.close()

            # Check if JavaScript bridge is available and data is large enough
            import js

            if hasattr(js, "js_upload_binary") and len(png_data) > artifact.threshold:
                # Use Phase 2 direct binary upload for large images
                async def upload_and_display():
                    try:
                        metadata = {
                            "source": "matplotlib",
                            "width": int(fig.get_figwidth() * fig.dpi),
                            "height": int(fig.get_figheight() * fig.dpi),
                        }
                        artifact_id = await artifact.upload_binary(
                            png_data, "image/png", metadata
                        )
                        js.js_display_artifact(artifact_id, "image/png", metadata)
                    except Exception as e:
                        print(f"Artifact upload failed, falling back to base64: {e}")
                        # Fallback to normal IPython display
                        from IPython.display import Image, display

                        display(Image(data=png_data))

                # Run the async upload
                import asyncio

                try:
                    # Try to get current event loop
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        # Create task for running loop
                        import concurrent.futures

                        with concurrent.futures.ThreadPoolExecutor() as executor:
                            future = executor.submit(asyncio.run, upload_and_display())
                            future.result()
                    else:
                        # No running loop, run directly
                        asyncio.run(upload_and_display())
                except Exception as e:
                    print(f"Async execution failed, using fallback: {e}")
                    # Fallback to base64 display
                    import base64
                    from IPython.display import display

                    png_base64 = base64.b64encode(png_data).decode("ascii")
                    display_data = {"image/png": png_base64}
                    display(display_data, raw=True)
            else:
                # Fallback to normal IPython display for small images or when bridge unavailable
                import base64
                from IPython.display import display

                png_base64 = base64.b64encode(png_data).decode("ascii")
                display_data = {"image/png": png_base64}
                display(display_data, raw=True)

            plt.clf()
        except Exception as e:
            print(f"Error capturing plot: {e}")

    return _original_show(block=block) if block is not None else _original_show()


# Replace matplotlib show with Phase 2 enhanced version
plt.show = _capture_matplotlib_show_phase2


# Setup convenience functions for artifact system
def setup_artifact_bridge():
    """Setup artifact upload capabilities in Python environment"""
    # Make artifact uploader globally available
    globals()["artifact"] = artifact

    # Add convenience function for display
    def display_artifact(artifact_id: str, mime_type: str, metadata: dict = None):
        if metadata is None:
            metadata = {}
        import js

        js.js_display_artifact(artifact_id, mime_type, metadata)

    globals()["display_artifact"] = display_artifact


# Call setup
setup_artifact_bridge()


def setup_rich_formatters():
    """Set up rich formatters for pandas, numpy, and other data types"""

    try:
        import pandas as pd

        # Enhanced pandas display options for better notebook output
        pd.set_option("display.max_rows", 50)
        pd.set_option("display.max_columns", 20)
        pd.set_option("display.width", None)
        pd.set_option("display.max_colwidth", 100)
        pd.set_option("display.precision", 4)

    except ImportError:
        pass  # Pandas not available

    try:
        import numpy as np

        # Enhanced numpy display
        np.set_printoptions(precision=4, suppress=True, linewidth=120, threshold=1000)

    except ImportError:
        pass  # NumPy not available


# Apply rich formatters
setup_rich_formatters()


def format_exception(exc_type, exc_value, exc_traceback):
    """Format exceptions with standard Python traceback formatting"""
    try:
        import traceback

        # Use standard traceback formatting to preserve exception type information
        return "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    except Exception as format_error:
        # Log formatting errors to structured logs instead of stderr
        print(
            f"[FORMATTER_ERROR] Failed to format exception: {format_error}", flush=True
        )
        # Fallback to basic formatting
        return f"{exc_type.__name__}: {exc_value}"


# Override exception formatting
sys.excepthook = lambda exc_type, exc_value, exc_traceback: print(
    format_exception(exc_type, exc_value, exc_traceback), file=sys.stderr
)

print("IPython environment ready with rich display support")


# Set up global callbacks (will be overridden by worker)
def default_display_callback(data, metadata, transient, update=False):
    """Default display callback - does nothing"""
    pass


def default_execution_callback(execution_count, data, metadata):
    """Default execution callback - does nothing"""
    pass


def default_clear_callback(wait=False):
    """Default clear callback - does nothing"""
    pass


async def bootstrap_micropip_packages():
    try:
        import micropip

        await micropip.install("seaborn")

        print("Installed seaborn via micropip")
    except Exception as e:
        print(f"Warning: Failed to install seaborn: {e}")


def setup_interrupt_patches():
    """Patch Python functions to make them interrupt-aware"""
    import time
    import builtins
    import signal
    import sys
    import threading

    # Store original functions
    _original_sleep = time.sleep
    _original_input = builtins.input if hasattr(builtins, "input") else None

    # Global flag to track if we should check for interrupts
    _interrupt_check_enabled = True

    # Set up signal handler for proper interrupt handling
    def signal_handler(signum, frame):
        """Handle interrupt signals by raising KeyboardInterrupt"""
        print(
            f"[INTERRUPT] Signal {signum} received, raising KeyboardInterrupt",
            flush=True,
        )
        raise KeyboardInterrupt("Execution interrupted by signal")

    # Install the signal handler for SIGINT
    try:
        signal.signal(signal.SIGINT, signal_handler)
        print("Signal handler installed for SIGINT", flush=True)
    except Exception as e:
        print(f"Warning: Could not install signal handler: {e}", flush=True)

    def check_interrupt():
        """Check for interrupts using Pyodide's mechanism"""
        if not _interrupt_check_enabled:
            return

        try:
            # This will be available when running in Pyodide
            if hasattr(__builtins__, "pyodide_check_interrupt"):
                __builtins__.pyodide_check_interrupt()
        except KeyboardInterrupt:
            print(
                "[INTERRUPT] KeyboardInterrupt detected via pyodide_check_interrupt",
                flush=True,
            )
            raise
        except Exception as e:
            # Don't spam errors, just continue
            pass

    def interrupt_aware_sleep(duration):
        """Sleep function that checks for interrupts periodically"""
        if duration <= 0:
            return

        # Check for interrupts in smaller chunks for better responsiveness
        chunk_size = 0.05  # 50ms chunks for better responsiveness
        remaining = float(duration)

        while remaining > 0:
            # Check for interrupt before each chunk
            check_interrupt()

            # Sleep for the smaller of chunk_size or remaining time
            sleep_time = min(chunk_size, remaining)

            try:
                _original_sleep(sleep_time)
            except KeyboardInterrupt:
                print("[INTERRUPT] KeyboardInterrupt during sleep", flush=True)
                raise

            remaining -= sleep_time

    def interrupt_aware_input(prompt=""):
        """Input function that can be interrupted"""
        check_interrupt()

        # Call original input (this will still block, but at least we checked once)
        if _original_input:
            try:
                return _original_input(prompt)
            except KeyboardInterrupt:
                print("[INTERRUPT] KeyboardInterrupt during input", flush=True)
                raise
        else:
            # Fallback if input is not available
            return ""

    # Patch the functions
    time.sleep = interrupt_aware_sleep
    if _original_input:
        builtins.input = interrupt_aware_input

    # Note: range() patching was too invasive and broke micropip
    # Pure Python loops are already interruptible via bytecode-level checks

    # Add a periodic interrupt checker that can be called from user code
    def periodic_interrupt_check():
        """Function users can call in their loops to check for interrupts"""
        check_interrupt()

    # Make the interrupt checker available globally
    builtins.check_interrupt = periodic_interrupt_check

    print("Interrupt-aware function patches applied with enhanced signal handling")


# Make callbacks available globally
js_display_callback = default_display_callback
js_execution_callback = default_execution_callback
js_clear_callback = default_clear_callback

# Set up interrupt patches
setup_interrupt_patches()

# Export the configured shell for use by the worker
__all__ = [
    "shell",
    "js_display_callback",
    "js_execution_callback",
    "js_clear_callback",
    "setup_interrupt_patches",
]
