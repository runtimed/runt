"""
Pseudo-IPython shell setup and configuration for Runt Runtime

This module provides a pseudo-IPython shell instance that mimics IPython
functionality with enhanced display capabilities, interrupt handling, and
error formatting. It's designed as a sandbox environment to demonstrate
runt working with an interactive Python environment.
"""

import os
import sys
import signal
import time
import builtins
from typing import Optional

from IPython.core.interactiveshell import InteractiveShell
from IPython.core.history import HistoryManager

from .display import RichDisplayHook, RichDisplayPublisher, setup_rich_formatters
from .display import js_display_callback, js_execution_callback, js_clear_callback


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
    except Exception as e:
        # Fallback to basic formatting if rich formatting fails
        return f"{exc_type.__name__}: {exc_value}"


def setup_interrupt_patches():
    """Set up interrupt handling and signal management"""

    def signal_handler(signum, frame):
        """Enhanced signal handler with proper interrupt support"""
        print(f"Received signal {signum}")
        if signum == signal.SIGINT:
            # Raise keyboard interrupt
            raise KeyboardInterrupt("Interrupted by user")

    def check_interrupt():
        """Check for interrupt requests from the worker"""
        try:
            # Import here to avoid circular imports
            import js

            # Check if pyodide interrupt buffer indicates an interrupt
            if hasattr(js, "pyodide") and hasattr(js.pyodide, "checkInterrupt"):
                js.pyodide.checkInterrupt()
        except Exception:
            # If interrupt checking fails, just continue
            pass

    def interrupt_aware_sleep(duration):
        """Sleep function that can be interrupted"""
        start_time = time.time()
        end_time = start_time + duration

        while time.time() < end_time:
            check_interrupt()
            remaining = end_time - time.time()
            if remaining > 0:
                # Sleep in small chunks to allow interrupt checking
                time.sleep(min(0.1, remaining))

    def interrupt_aware_input(prompt=""):
        """Input function that can be interrupted"""
        print(prompt, end="", flush=True)

        # For now, we'll just return empty string as input is complex in web workers
        # In a real implementation, this would need to coordinate with the main thread
        return ""

    # Install signal handler for SIGINT
    try:
        signal.signal(signal.SIGINT, signal_handler)
        print("Signal handler installed for SIGINT")
    except (OSError, ValueError) as e:
        print(f"Could not install signal handler: {e}")

    # Patch built-in functions with interrupt-aware versions
    def periodic_interrupt_check():
        """Periodically check for interrupts during long operations"""
        check_interrupt()

    # Monkey patch time.sleep to be interrupt-aware
    original_sleep = time.sleep
    time.sleep = interrupt_aware_sleep

    # Monkey patch input to be interrupt-aware
    original_input = builtins.input
    builtins.input = interrupt_aware_input

    # Set up periodic interrupt checking
    # Note: In a real implementation, this might use threading or async approaches

    print("Interrupt-aware function patches applied with enhanced signal handling")


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
