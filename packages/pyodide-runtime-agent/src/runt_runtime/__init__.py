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

# Note: ipython_setup module is NOT imported automatically to avoid side effects
# It must be imported explicitly by the caller when IPython setup is needed
