"""
Interrupt handling for Pyodide runtime.

This module provides interrupt-aware versions of Python functions like sleep() and input()
to make them responsive to keyboard interrupts in the Pyodide environment.

NOTE: This is largely fixed in newer Pyodide releases, but we're stuck with this approach
as those releases don't support pyarrow, duckdb, and other binary builds at this time.
"""

import signal
import time
import builtins


def _setup_signal_handler():
    """Set up signal handler for proper interrupt handling."""

    def signal_handler(signum, frame):
        """Handle interrupt signals by raising KeyboardInterrupt"""
        print(
            f"[INTERRUPT] Signal {signum} received, raising KeyboardInterrupt",
            flush=True,
        )
        raise KeyboardInterrupt("Execution interrupted by signal")

    try:
        signal.signal(signal.SIGINT, signal_handler)
        print("Signal handler installed for SIGINT", flush=True)
    except Exception as e:
        print(f"Warning: Could not install signal handler: {e}", flush=True)


def _check_interrupt():
    """Check for interrupts using Pyodide's mechanism."""
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
        print(f"Error checking interrupt: {e}", flush=True)
        pass


def _create_interrupt_aware_sleep(original_sleep):
    """Create an interrupt-aware version of time.sleep()."""

    def interrupt_aware_sleep(duration):
        """Sleep function that checks for interrupts periodically"""
        if duration <= 0:
            return

        # Check for interrupts in smaller chunks for better responsiveness
        chunk_size = 0.05  # 50ms chunks for better responsiveness
        remaining = float(duration)

        while remaining > 0:
            # Check for interrupt before each chunk
            _check_interrupt()

            # Sleep for the smaller of chunk_size or remaining time
            sleep_time = min(chunk_size, remaining)

            try:
                original_sleep(sleep_time)
            except KeyboardInterrupt:
                print("[INTERRUPT] KeyboardInterrupt during sleep", flush=True)
                raise

            remaining -= sleep_time

    return interrupt_aware_sleep


def _create_interrupt_aware_input(original_input):
    """Create an interrupt-aware version of input()."""

    def interrupt_aware_input(prompt=""):
        """Input function that can be interrupted"""
        _check_interrupt()

        # Call original input (this will still block, but at least we checked once)
        if original_input:
            try:
                return original_input(prompt)
            except KeyboardInterrupt:
                print("[INTERRUPT] KeyboardInterrupt during input", flush=True)
                raise
        else:
            # Fallback if input is not available
            return ""

    return interrupt_aware_input


def _create_periodic_interrupt_check():
    """Create a function users can call in their loops to check for interrupts."""

    def periodic_interrupt_check():
        """Function users can call in their loops to check for interrupts"""
        _check_interrupt()

    return periodic_interrupt_check


def setup_interrupt_patches():
    """
    Patch Python functions to make them interrupt-aware.

    This function sets up interrupt handling by:
    1. Installing signal handlers
    2. Patching time.sleep() to check for interrupts periodically
    3. Patching input() to check for interrupts before blocking
    4. Making interrupt checking available to user code
    """
    # Store original functions
    original_sleep = time.sleep
    original_input = builtins.input if hasattr(builtins, "input") else None

    # Set up signal handler
    _setup_signal_handler()

    # Create interrupt-aware versions
    interrupt_aware_sleep = _create_interrupt_aware_sleep(original_sleep)
    interrupt_aware_input = _create_interrupt_aware_input(original_input)
    periodic_interrupt_check = _create_periodic_interrupt_check()

    # Patch the functions
    time.sleep = interrupt_aware_sleep
    if original_input:
        builtins.input = interrupt_aware_input

    # Make the interrupt checker available globally
    builtins.check_interrupt = periodic_interrupt_check

    print("Interrupt-aware function patches applied with enhanced signal handling")
