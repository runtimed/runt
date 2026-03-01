"""runtimed - Python toolkit for Jupyter runtimes."""

from importlib.metadata import PackageNotFoundError, version

# Existing sidecar functionality
from runtimed._sidecar import BridgedSidecar, Sidecar, sidecar

# Native daemon client (PyO3 bindings)
from runtimed.runtimed import (
    DaemonClient,
    ExecutionResult,
    Output,
    RuntimedError,
    Session,
)

__all__ = [
    # Existing
    "BridgedSidecar",
    "Sidecar",
    "sidecar",
    # Daemon client API
    "DaemonClient",
    "Session",
    "ExecutionResult",
    "Output",
    "RuntimedError",
]

try:
    __version__ = version("runtimed")
except PackageNotFoundError:
    __version__ = "0.0.0-dev"
