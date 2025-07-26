"""
Pseudo-IPython shell setup and configuration for Runt Runtime

This module provides a pseudo-IPython shell instance that mimics IPython
functionality with enhanced display capabilities, interrupt handling, and
error formatting. It's designed as a sandbox environment to demonstrate
runt working with an interactive Python environment.
"""

import os


from IPython.core.interactiveshell import InteractiveShell
from IPython.core.history import HistoryManager

from runt_runtime_display import (
    RichDisplayHook,
    RichDisplayPublisher,
    setup_rich_formatters,
)
from runt_runtime_display import (
    js_display_callback,
    js_execution_callback,
    js_clear_callback,
)
from runt_runtime_interrupt_patches import setup_interrupt_patches


class LiteHistoryManager(HistoryManager):
    """Lightweight history manager for web environment"""

    def __init__(self, shell=None, config=None, **traits):
        self.enabled = False
        super().__init__(shell=shell, config=config, **traits)


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

# Create pseudo-IPython shell instance with enhanced display capabilities
shell = InteractiveShell.instance(
    displayhook_class=RichDisplayHook,
    display_pub_class=RichDisplayPublisher,
)

# Override history manager
shell.history_manager = LiteHistoryManager(shell=shell, parent=shell)


def format_exception(exc_type, exc_value, exc_traceback):
    """Enhanced exception formatting with rich output"""
    try:
        import traceback

        # Format the traceback
        tb_lines = traceback.format_exception(exc_type, exc_value, exc_traceback)

        # Join and clean up the traceback
        formatted_tb = "".join(tb_lines).strip()

        return formatted_tb
    except Exception:
        # Fallback to basic formatting if rich formatting fails
        return f"{exc_type.__name__}: {exc_value}"


def initialize_ipython_environment():
    """Initialize the pseudo-IPython sandbox environment with all setup functions"""

    # Set up display callbacks on the shell's display publisher and hook
    if hasattr(shell, "display_pub") and hasattr(shell.display_pub, "js_callback"):
        shell.display_pub.js_callback = js_display_callback

    if hasattr(shell, "displayhook") and hasattr(shell.displayhook, "js_callback"):
        shell.displayhook.js_callback = js_execution_callback

    if hasattr(shell, "display_pub") and hasattr(
        shell.display_pub, "js_clear_callback"
    ):
        shell.display_pub.js_clear_callback = js_clear_callback

    # Apply rich formatters
    setup_rich_formatters()

    # Set up interrupt patches
    setup_interrupt_patches()

    print("Pseudo-IPython environment ready with rich display support")


# Configure matplotlib for headless PNG output (works in Deno workers)
try:
    import matplotlib
    import matplotlib.pyplot as plt

    matplotlib.use("Agg")
    plt.rcParams["figure.dpi"] = 100
    plt.rcParams["savefig.dpi"] = 100
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["savefig.facecolor"] = "white"
    plt.rcParams["figure.figsize"] = (8, 6)

except ImportError:
    # Matplotlib not available
    pass
