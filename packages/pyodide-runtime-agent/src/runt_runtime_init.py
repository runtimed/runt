"""
Runt Runtime - Pseudo-IPython sandbox environment for Pyodide-based execution

This package provides a sandbox environment that mimics IPython functionality
with rich display support, function registry, and enhanced output handling
for use in Pyodide workers. It's designed to demonstrate runt working with
a nice interactive Python environment.

Main components:
- Pseudo-IPython shell with rich display formatting
- Function registry for tool registration and execution
- Interrupt handling and signal management
- Matplotlib integration for plot display
- Package bootstrapping utilities
"""

from .shell import shell, initialize_ipython_environment
from .registry import get_registered_tools, run_registered_tool, tool, function_registry
from .display import js_display_callback, js_execution_callback, js_clear_callback
from .bootstrap import bootstrap_micropip_packages

__all__ = [
    # Core shell and initialization
    "shell",
    "initialize_ipython_environment",
    # Function registry and tools
    "get_registered_tools",
    "run_registered_tool",
    "tool",
    "function_registry",
    # Display callbacks
    "js_display_callback",
    "js_execution_callback",
    "js_clear_callback",
    # Bootstrap utilities
    "bootstrap_micropip_packages",
]

# Package metadata
__version__ = "0.1.0"
__author__ = "Runt Runtime Team"
__description__ = "Pseudo-IPython sandbox environment for Pyodide-based execution"
