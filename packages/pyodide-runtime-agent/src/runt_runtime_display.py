"""
Display handling and formatting for Runt Runtime

This module provides rich display capabilities including:
- Custom display publishers and hooks for IPython
- JavaScript callback integration for rich output
- Matplotlib plot capture and formatting
- Serialization utilities for complex Python objects
"""

import io
import json
import base64
from typing import Any, Dict, Optional, Callable


class RichDisplayPublisher:
    """Enhanced display publisher for rich output handling"""

    def __init__(self, shell=None, *args, **kwargs):
        # Import here to avoid circular imports
        from IPython.core.displaypub import DisplayPublisher

        super(RichDisplayPublisher, self).__init__(shell, *args, **kwargs)
        self.js_callback = None

    def publish(
        self,
        data,
        metadata=None,
        source=None,
        *,
        transient=None,
        update=False,
    ):
        """Enhanced publish with rich data handling"""
        if self.js_callback:
            try:
                # Make data serializable
                serializable_data = self._make_serializable(data)
                serializable_metadata = self._make_serializable(metadata)
                serializable_transient = self._make_serializable(transient)

                self.js_callback(
                    serializable_data,
                    serializable_metadata,
                    serializable_transient,
                    update,
                )
            except Exception as e:
                print(f"Error in display callback: {e}")
                import traceback

                traceback.print_exc()

    def clear_output(self, wait=False):
        """Clear output with JavaScript callback"""
        if hasattr(self, "js_clear_callback") and self.js_clear_callback:
            try:
                self.js_clear_callback(wait)
            except Exception as e:
                print(f"Error in clear callback: {e}")

    def _make_serializable(self, obj):
        """Convert complex Python objects to JSON-serializable format"""
        if obj is None:
            return None

        if isinstance(obj, (str, int, float, bool)):
            return obj

        if isinstance(obj, (list, tuple)):
            return [self._make_serializable(item) for item in obj]

        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                try:
                    # Ensure key is string
                    str_key = str(key)
                    result[str_key] = self._make_serializable(value)
                except Exception as e:
                    print(f"Warning: Could not serialize key {key}: {e}")
                    result[str(key)] = f"<unserializable: {type(value).__name__}>"
            return result

        # Handle bytes objects (common in image data)
        if isinstance(obj, bytes):
            try:
                return base64.b64encode(obj).decode("ascii")
            except Exception:
                return f"<binary data: {len(obj)} bytes>"

        # For other objects, try to convert to string representation
        try:
            return str(obj)
        except Exception:
            return f"<unserializable: {type(obj).__name__}>"


class RichDisplayHook:
    """Enhanced display hook with rich output formatting"""

    def __init__(self, shell=None, cache_size=1000):
        self.shell = shell
        self.js_callback = None

    def __call__(self, result):
        """Process execution results with rich formatting"""
        if result is not None:
            try:
                # Convert result to serializable format
                serializable_result = self._make_serializable(result)

                if self.js_callback:
                    # Get execution count from shell if available
                    execution_count = getattr(self.shell, "execution_count", 0)
                    self.js_callback(execution_count, serializable_result, None)

                # Also store in shell's output history if available
                if self.shell:
                    self.shell.user_ns["_"] = result

            except Exception as e:
                print(f"Error in display hook: {e}")
                import traceback

                traceback.print_exc()

    def _make_serializable(self, obj):
        """Convert complex Python objects to JSON-serializable format"""
        if obj is None:
            return None

        if isinstance(obj, (str, int, float, bool)):
            return obj

        if isinstance(obj, (list, tuple)):
            return [self._make_serializable(item) for item in obj]

        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                try:
                    str_key = str(key)
                    result[str_key] = self._make_serializable(value)
                except Exception as e:
                    print(f"Warning: Could not serialize key {key}: {e}")
                    result[str(key)] = f"<unserializable: {type(value).__name__}>"
            return result

        # Handle bytes objects
        if isinstance(obj, bytes):
            try:
                return base64.b64encode(obj).decode("ascii")
            except Exception:
                return f"<binary data: {len(obj)} bytes>"

        # Handle common scientific computing objects
        try:
            # Try pandas DataFrame/Series
            if hasattr(obj, "to_dict"):
                return self._make_serializable(obj.to_dict())
        except Exception:
            pass

        try:
            # Try numpy arrays
            if hasattr(obj, "tolist"):
                return self._make_serializable(obj.tolist())
        except Exception:
            pass

        # For other objects, try string representation
        try:
            return str(obj)
        except Exception:
            return f"<unserializable: {type(obj).__name__}>"


def _capture_matplotlib_show():
    """Enhanced matplotlib show function with inline image capture"""
    import matplotlib.pyplot as plt
    import matplotlib

    # Store original show function
    original_show = plt.show

    def enhanced_show(*args, **kwargs):
        """Capture matplotlib plots and display them inline"""
        try:
            # Get current figure
            fig = plt.gcf()
            if fig.get_axes():
                # Save to PNG in memory
                buf = io.BytesIO()
                fig.savefig(
                    buf,
                    format="png",
                    dpi=100,
                    bbox_inches="tight",
                    facecolor="white",
                    edgecolor="none",
                )
                buf.seek(0)
                img_data = buf.getvalue()
                buf.close()

                # Encode as base64
                import base64

                img_base64 = base64.b64encode(img_data).decode()

                # Create display data
                display_data = {
                    "image/png": img_base64,
                    "text/plain": f"<matplotlib figure: {fig.__class__.__name__}>",
                }

                # Use IPython display system
                try:
                    from IPython.display import display

                    display(display_data, raw=True)
                except ImportError:
                    # Fallback - print base64 data marker
                    print(f"IMAGE_DATA:PNG:{img_base64}")

                # Clear the figure to prevent memory leaks
                plt.clf()
        except Exception as e:
            print(f"Error capturing matplotlib plot: {e}")
            # Fall back to original behavior
            original_show(*args, **kwargs)

    # Replace plt.show
    plt.show = enhanced_show


# Default callback implementations
def default_display_callback(data, metadata, transient, update=False):
    """Default display callback that prints to stdout"""
    print(f"DISPLAY: {data}")


def default_execution_callback(execution_count, data, metadata):
    """Default execution callback that prints results"""
    print(f"OUT[{execution_count}]: {data}")


def default_clear_callback(wait=False):
    """Default clear callback"""
    print("CLEAR_OUTPUT")


# JavaScript callback placeholders - these will be set by the worker
js_display_callback = default_display_callback
js_execution_callback = default_execution_callback
js_clear_callback = default_clear_callback


def setup_rich_formatters():
    """Set up rich display formatters for various data types"""
    try:
        # Set up matplotlib integration
        _capture_matplotlib_show()
        print("Enhanced matplotlib display support enabled")
    except ImportError:
        print("Matplotlib not available, skipping plot capture setup")

    try:
        # Set up pandas formatting if available
        import pandas as pd

        # Configure pandas display options for better formatting
        pd.set_option("display.max_columns", 20)
        pd.set_option("display.max_rows", 100)
        pd.set_option("display.width", None)
        pd.set_option("display.max_colwidth", 50)
        print("Enhanced pandas display support enabled")
    except ImportError:
        pass  # Pandas not available

    try:
        # Set up numpy formatting if available
        import numpy as np

        # Configure numpy display options
        np.set_printoptions(threshold=100, edgeitems=3, linewidth=120)
        print("Enhanced numpy display support enabled")
    except ImportError:
        pass  # NumPy not available

    print("Rich formatters setup complete")
