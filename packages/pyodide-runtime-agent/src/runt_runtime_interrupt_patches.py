"""
Interrupt handling and signal management for Runt Runtime

This module provides interrupt-aware replacements for built-in functions
and handles signal management in the Pyodide environment. It uses module-level
singleton storage to prevent double-patching issues.
"""

import signal
import time
import builtins


# Module-level singleton storage for original functions to prevent double-patching
_original_sleep = None
_original_input = None


def _signal_handler(signum, frame):
    """Enhanced signal handler with proper interrupt support"""
    print(f"Received signal {signum}")
    if signum == signal.SIGINT:
        # Raise keyboard interrupt
        raise KeyboardInterrupt("Interrupted by user")


def _check_interrupt():
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


def _interrupt_aware_sleep(duration):
    """Sleep function that can be interrupted"""
    global _original_sleep

    start_time = time.time()
    end_time = start_time + duration

    while time.time() < end_time:
        _check_interrupt()
        remaining = end_time - time.time()
        if remaining > 0:
            # Sleep in small chunks to allow interrupt checking
            _original_sleep(min(0.1, remaining))


def _interrupt_aware_input(prompt=""):
    """Input function that can be interrupted"""
    print(prompt, end="", flush=True)

    # For now, we'll just return empty string as input is complex in web workers
    # In a real implementation, this would need to coordinate with the main thread
    return ""


def _setup_signal_handlers():
    """Set up signal handlers for interrupt handling"""
    try:
        signal.signal(signal.SIGINT, _signal_handler)
        print("Signal handler installed for SIGINT")
    except (OSError, ValueError):
        print("Could not install signal handler")


def _patch_builtin_functions():
    """Patch built-in functions with interrupt-aware versions"""
    # Monkey patch time.sleep to be interrupt-aware
    time.sleep = _interrupt_aware_sleep

    # Monkey patch input to be interrupt-aware
    builtins.input = _interrupt_aware_input


def _store_original_functions():
    """Store original functions once to prevent double-patching"""
    global _original_sleep, _original_input

    if _original_sleep is None:
        _original_sleep = time.sleep
    if _original_input is None:
        _original_input = builtins.input


def setup_interrupt_patches():
    """Set up interrupt handling and signal management

    This function can be called multiple times safely due to singleton storage
    of original functions at the module level.
    """
    # Store original functions to prevent double-patching
    _store_original_functions()

    # Set up signal handlers
    _setup_signal_handlers()

    # Patch built-in functions with interrupt-aware versions
    _patch_builtin_functions()

    print("Interrupt-aware function patches applied with enhanced signal handling")


def check_interrupt():
    """Public interface for checking interrupts

    This can be called by user code or other modules to check for interrupts.
    """
    _check_interrupt()


# Export the main setup function and public interrupt checker
__all__ = ["setup_interrupt_patches", "check_interrupt"]
