"""
Display handling and formatting for Runt Runtime

This module provides rich display capabilities including:
- Custom display publishers and hooks for IPython
- JavaScript callback integration for rich output
- Matplotlib plot capture and formatting
- Serialization utilities for complex Python objects
"""

import io

from IPython.core.displaypub import DisplayPublisher
from IPython.core.displayhook import DisplayHook


class RichDisplayPublisher(DisplayPublisher):
    """Enhanced display publisher for rich IPython output handling"""

    def __init__(self, shell=None, *args, **kwargs):
        super(RichDisplayPublisher, self).__init__(shell=shell, *args, **kwargs)
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
        """Publish with JavaScript callback using IPython's formatted data"""
        # Call our JavaScript callback with the formatted data if available
        if self.js_callback:
            try:
                self.js_callback(data, metadata, transient, update)
            except Exception as e:
                print(f"Error in display callback: {e}")

    def clear_output(self, wait=False):
        """Clear output with JavaScript callback"""
        if hasattr(self, "js_clear_callback") and self.js_clear_callback:
            try:
                self.js_clear_callback(wait)
            except Exception as e:
                print(f"Error in clear callback: {e}")


class RichDisplayHook(DisplayHook):
    """Enhanced display hook that uses IPython's built-in formatting"""

    def __init__(self, shell=None, cache_size=1000, **kwargs):
        super(RichDisplayHook, self).__init__(
            shell=shell, cache_size=cache_size, **kwargs
        )
        self.js_callback = None

    def __call__(self, result):
        """Process execution results using IPython's formatters"""
        if result is not None:
            # Use IPython's formatters to get properly formatted display data
            if self.shell and hasattr(self.shell, "display_formatter"):
                format_dict, metadata_dict = self.shell.display_formatter.format(result)

                # Call our JavaScript callback with formatted data
                if self.js_callback:
                    try:
                        execution_count = getattr(self.shell, "execution_count", 0)
                        self.js_callback(execution_count, format_dict, metadata_dict)
                    except Exception as e:
                        print(f"Error in display hook callback: {e}")
            else:
                # Fallback if no formatter available
                if self.js_callback:
                    try:
                        execution_count = getattr(self.shell, "execution_count", 0)
                        self.js_callback(execution_count, result, None)
                    except Exception as e:
                        print(f"Error in display hook callback: {e}")


def _capture_matplotlib_show():
    """Matplotlib show function with inline image capture"""
    import matplotlib.pyplot as plt

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
        print("Matplotlib display support enabled")
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
        print("Pandas options set")
    except ImportError:
        pass  # Pandas not available

    try:
        # Set up numpy formatting if available
        import numpy as np

        # Configure numpy display options
        np.set_printoptions(threshold=100, edgeitems=3, linewidth=120)
        print("Numpy display support enabled")
    except ImportError:
        pass  # NumPy not available

    print("Rich formatters setup complete")
