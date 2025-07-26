"""
Runt runtime package for Pyodide.

This package provides the function registry system and IPython setup
for the Runt Pyodide runtime agent.

Main components:
- Function registry for tool registration and execution
- IPython environment setup with rich display support
- Interrupt handling and signal management
"""

from .registry import (
    FunctionRegistry,
    FunctionDefinition,
    FunctionError,
    FunctionArgumentError,
    UnknownFunctionError,
    generate_function_schema,
    extract_arguments,
)

__all__ = [
    "FunctionRegistry",
    "FunctionDefinition",
    "FunctionError",
    "FunctionArgumentError",
    "UnknownFunctionError",
    "generate_function_schema",
    "extract_arguments",
]

__version__ = "0.1.0"

# Import ipython_setup module for side effects
# This must be imported last to ensure all dependencies are available
# It sets up the IPython environment, display handlers, interrupt handling, etc.
from . import ipython_setup  # noqa: F401 - imported for side effects
